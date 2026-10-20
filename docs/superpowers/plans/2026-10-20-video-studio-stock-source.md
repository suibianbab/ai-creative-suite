# Video Studio P2.5-T5 实施计划：Wikimedia Commons 在线素材源

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在镜头卡的媒体编辑臂内提供 Wikimedia Commons 检索 → 人工选用 → 服务端下载核验 → 直接落成该卡媒体镜头（可继续编辑替换）的受控链路。

**Architecture:** 检索/归一化/下载/入库编排放 `@acs/media-store` 新增 `stock/` 模块（Node-only，纯函数 + 注入 fetch/ingest）；web 两条薄路由（search/import）承接 dev 门与状态码；镜头卡内面板只做渲染与状态机；页面以「最新文档 ref → 组新文档 → 只保存一次」完成单事务，避免孤立资产与丢更新。

**Tech Stack:** TypeScript（NodeNext / strict）、Node 22 `fetch` + `ReadableStream`、Next 16 route handlers、React 19、`node:test`、`@acs/media-store` / `@acs/video-document`。

**Spec:** `docs/superpowers/specs/2026-10-20-video-studio-stock-source-design.md`

## Global Constraints

- 单测**零网络**：不触真实 Wikimedia / upload.wikimedia.org；`fetch` 与 `ingestMediaFile` 全注入，夹具为合成 JSON/字节流。
- 零计费：`artifacts/tts-usage.jsonl` 保持 34 行不变。
- 媒体与证据不入库（`artifacts/` 下证据文件 untracked）。
- 错误消息逐字用 spec §3 的中文文案；仓/manifest/字段名保持英文。
- 两条新路由仅 `NODE_ENV === "development"` 开放；import 路由做同源校验（沿 `api/media/ingest/route.ts`）。
- 下载上限 500MB、总超时 300s、空闲超时 30s、重试 3 次（间隔 1s、2s）；档位长边 ≤1920；检索固定 10 条；UA 固定 `ACS-VideoStudio/0.1 (local development)`。
- 不 push / 不 merge；每任务一次提交；每任务收口跑 biome 与相关 typecheck。

## Review Focus

1. **只有 ogv 档位的候选**：应展示但禁用并给「无受支持的分辨率档位」原因，不得崩溃或下载。
2. **下载期间（最长 300s）用户改了别的镜头**：完成时以最新文档为基线，不得覆盖；镜头被删则素材入库、不重建镜头。
3. **保存失败**：`saveVideoProject` 抛错时页面不得 `setEditor`，文档字节不变；仓内未被账本引用的内容寻址文件是接受的孤儿，不当作资产。
4. **伪装来源**：`http://`、非 `upload.wikimedia.org`、带端口/凭据、`upload.wikimedia.org.evil.com`、以及不在候选 `derivatives` 中的 URL，都必须在 fetch 前拒绝。
5. **Artist/Credit 是 HTML**：清洗后展示与入账，不得把 `<a ...>` 原样塞进 UI 或许可字段。

---

### Task 1: `ingestMediaFile` origin 参数化

**Files:**
- Modify: `packages/media-store/src/ingest.ts:40,168-192`
- Test: `packages/media-store/src/ingest.test.ts`

**Interfaces:**
- Consumes: 现有 `MediaAsset` 契约。
- Produces:
  ```ts
  export type IngestOrigin =
    | { kind: "local-upload"; fileName: string }
    | { kind: "stock-source"; sourceId: "wikimedia"; sourcePageUrl: string;
        license: { name: string; author?: string; usageNote?: string };
        retrievedAt: string };
  // ingestMediaFile 入参新增（可选，默认 = {kind:"local-upload", fileName}）
  origin?: IngestOrigin;
  ```

- [ ] **Step 1: 写失败测试**

在 `ingest.test.ts` 末尾新增（复用 `makeTestVideo`/`storeRoot`/`FIXED_NOW`）：

```ts
test("stock origin：传入 stock-source 时资产 origin 原样落账（不被 local-upload 覆盖）", async () => {
  const bytes = makeTestVideo("stock-origin.mp4");
  const origin = {
    kind: "stock-source" as const,
    sourceId: "wikimedia" as const,
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Demo.mp4",
    license: { name: "CC BY-SA 4.0", author: "Demo Author", usageNote: "须署名" },
    retrievedAt: FIXED_NOW,
  };
  const result = await ingestMediaFile({
    bytes, fileName: "Demo.mp4", root: storeRoot("stock-origin"),
    now: () => FIXED_NOW, origin,
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.deepEqual(result.asset.origin, origin);
});
```

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/media-store test`
Expected: 编译失败（`origin` 不在入参类型中）。

- [ ] **Step 3: 最小实现**

`ingest.ts`：把 `IngestOrigin` 扩成上面的联合；`ingestMediaFile` 入参加 `origin?: IngestOrigin`；`buildAsset` 里把硬编码替换为 `input.origin ?? { kind: "local-upload", fileName: input.fileName }`。不改扩展名门、时长门、代理与清理逻辑。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/media-store test`
Expected: 全绿（原 31 + 1）。

- [ ] **Step 5: Commit**

```bash
git add packages/media-store/src/ingest.ts packages/media-store/src/ingest.test.ts
git commit -m "feat(media-store): ingest 支持传入 stock-source origin（默认 local-upload 不变）"
```

---

### Task 2: Wikimedia 纯适配器（检索 URL / 归一化 / 许可 / 档位）

**Files:**
- Create: `packages/media-store/src/stock/types.ts`
- Create: `packages/media-store/src/stock/wikimedia.ts`
- Create: `packages/media-store/src/stock/wikimedia.test.ts`
- Modify: `packages/media-store/src/index.ts`（导出新类型与函数）

**Interfaces:**
- Produces（后续任务只认这些名字）：
  ```ts
  export type StockDerivative = {
    url: string; mime: string; container: "mp4" | "webm" | "mov";
    width: number; height: number; label: string; estimatedBytes?: number;
  };
  export type StockCandidateDisabledReason =
    | "许可不明" | "无受支持的分辨率档位（仅 mp4/webm/mov）"
    | "时长超出支持范围（200ms..10 分钟）" | "全部档位超过 1920 长边";
  export type StockCandidate = {
    sourceId: "wikimedia"; pageTitle: string; displayTitle: string;
    sourcePageUrl: string; thumbnailUrl?: string;
    durationMs: number; width: number; height: number; mime: string;
    license: { name: string; author?: string; usageNote?: string } | null;
    derivatives: StockDerivative[];
    defaultDerivativeUrl?: string; disabledReason?: StockCandidateDisabledReason;
  };
  export function buildWikimediaSearchUrl(query: string, limit?: number): string;
  export function buildWikimediaVideoInfoUrl(pageTitle: string): string;
  export function normalizeWikimediaPages(json: unknown):
    | { ok: true; candidates: StockCandidate[] }
    | { ok: false; error: string };
  export function isAllowedWikimediaAssetUrl(url: string): boolean;
  export function findDerivative(candidate: StockCandidate, url: string): StockDerivative | null;
  ```

- [ ] **Step 1: 写失败测试（14 条，合成夹具）**

在 `wikimedia.test.ts` 先写一个夹具工厂，字段形状以实测 Commons `formatversion=2` 为准：

```ts
function page(overrides: Record<string, unknown> = {}) {
  return {
    pageid: 1, ns: 6, title: "File:Demo clouds.webm",
    videoinfo: [{
      size: 12_345_678, width: 1920, height: 1080, duration: 12.5,
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Demo_clouds.webm",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Demo_clouds.webm",
      mime: "video/webm", thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Demo_clouds.webm/320px.jpg",
      extmetadata: {
        LicenseShortName: { value: "CC BY-SA 4.0" },
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Demo">Demo Author</a>' },
        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
        AttributionRequired: { value: "true" },
      },
      derivatives: [
        { src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Demo_clouds.webm",
          type: 'video/webm; codecs="vp9, opus"', width: 1920, height: 1080, bandwidth: 2_000_000 },
        { src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Demo_clouds.webm/Demo_clouds.webm.480p.vp9.webm",
          type: 'video/webm; codecs="vp9, opus"', transcodekey: "480p.vp9.webm", width: 854, height: 480, bandwidth: 500_000 },
        { src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Demo_clouds.webm/Demo_clouds.webm.720p.vp9.webm",
          type: 'video/webm; codecs="vp9, opus"', transcodekey: "720p.vp9.webm", width: 1280, height: 720, bandwidth: 1_000_000 },
      ],
    }],
  };
}
```

测试名与关键断言：
1. `buildWikimediaSearchUrl`：含 `filetype:video`、`gsrnamespace=6`、`gsrlimit=10`、关键词 URL 编码、`formatversion=2`。
2. `buildWikimediaVideoInfoUrl`：`titles=` 编码、`prop=videoinfo`。
3. 正常归一化：`displayTitle === "Demo clouds"`、`durationMs === 12500`、`sourcePageUrl`、`thumbnailUrl`。
4. 许可映射：`name "CC BY-SA 4.0"`、`author "Demo Author"`（无 `<a`）、`usageNote` 含许可 URL 与「须署名」。
5. 无 `LicenseShortName` → `license === null` 且 `disabledReason === "许可不明"`。
6. 档位：只留 webm/mov/mp4（夹具加一条 `.ogv` 与一条 `.mov`）；`estimatedBytes = bandwidth × duration`（480p = 6_250_000 ±1）。
7. 默认档位：720p 在时选 720p；去掉 720p 后选 480p；只有 1080p 时选 1080p。
8. 全部档位 >1920 长边 → `disabledReason === "全部档位超过 1920 长边"`、`derivatives` 为空。
9. 只有 ogv 档位 → `disabledReason === "无受支持的分辨率档位（仅 mp4/webm/mov）"`。
10. `duration 600.5s` → `disabledReason === "时长超出支持范围（200ms..10 分钟）"`。
11. 缺 `videoinfo` 的页面跳过；`query.pages` 缺失 → `{ok:false}` 中文错误（不抛栈）。
12. `isAllowedWikimediaAssetUrl`：放行 https + upload.wikimedia.org + `/wikipedia/commons/`；拒 `http:`、`upload.wikimedia.org.evil.com`、`:8443`、`user:pass@`、`/wikipedia/other/`。
13. `findDerivative`：精确相等命中；不同 URL 返回 null。
14. Artist 含 `&amp;`/`&quot;` → 解码为 `&`/`"`，未见标签。

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/media-store test`
Expected: 编译失败（模块不存在）。

- [ ] **Step 3: 最小实现**

`stock/types.ts` 放类型；`stock/wikimedia.ts` 实现上述函数。要点：`formatversion=2` 下 `query.pages` 是数组、`videoinfo` 是数组；`duration` 秒→毫秒四舍五入；扩展名从 `src` 取；排序按宽度升序；`disabledReason` 优先级 = 许可不明 > 时长越界 > 无档位 > 全部超 1920；`normalizeWikimediaPages` 任何畸形输入返回 `{ok:false,error:"Wikimedia 响应不可解析"}`。`index.ts` 增加 `export * from "./stock/wikimedia.js"` 与 `export * from "./stock/types.js"`。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/media-store test`
Expected: 全绿（+14）。

- [ ] **Step 5: Commit**

```bash
git add packages/media-store/src/stock packages/media-store/src/index.ts
git commit -m "feat(media-store): Wikimedia 候选归一化与档位/许可/URL 校验纯函数"
```

---

### Task 3: 下载核验编排 `importStockCandidate`

**Files:**
- Create: `packages/media-store/src/stock/import.ts`
- Create: `packages/media-store/src/stock/import.test.ts`
- Modify: `packages/media-store/src/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `IngestOrigin`/`ingestMediaFile`；Task 2 的 `buildWikimediaVideoInfoUrl`/`normalizeWikimediaPages`/`isAllowedWikimediaAssetUrl`/`findDerivative`。
- Produces:
  ```ts
  export type StockImportReasonCode =
    | "upstream" | "timeout" | "too-large" | "unlicensed"
    | "mismatch" | "unsupported" | "ingest" | "store-error";
  export type StockImportResult =
    | { ok: true; asset: MediaAsset }
    | { ok: false; error: string; reasonCode: StockImportReasonCode; cleanupDone: true };
  export async function importStockCandidate(input: {
    pageTitle: string; derivativeUrl: string; root: string;
    fetchImpl?: typeof fetch;
    ingest?: typeof ingestMediaFile;
    now?: () => string; tempDir?: string;
    maxBytes?: number; totalTimeoutMs?: number; idleTimeoutMs?: number; retries?: number;
  }): Promise<StockImportResult>;
  ```
  默认值：`maxBytes 500_000_000`、`totalTimeoutMs 300_000`、`idleTimeoutMs 30_000`、`retries 3`。
- **测试注入**：`ingest` 用假实现（避免真实 ffmpeg），返回构造好的 `MediaAsset`；`fetchImpl` 按调用序列返回 JSON 与字节流。

- [ ] **Step 1: 写失败测试（12 条）**

辅助：
```ts
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function bytes(chunks: Uint8Array[], status = 200) {
  return new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } }), { status });
}
const fakeIngest = async (input) => ({ ok: true, asset: assetFor(input) });
```
测试名与断言：
1. 成功：fetch 先返回 videoinfo（含许可与档位）再返回字节；假 ingest 收到的 `origin.kind === "stock-source"`、`sourcePageUrl`/`license`/`retrievedAt` 来自重取、`fileName` 以 `.webm` 结尾；返回 asset。
2. 非白名单 host → 不触 fetch，`reasonCode "unsupported"`，消息含 `素材来源无效`。
3. URL 不在重取档位中 → 只发生一次 metadata fetch，`reasonCode "unsupported"`，消息含 `该分辨率档位不属于此候选`。
4. 重取无许可 → `reasonCode "unlicensed"`，消息含 `候选许可信息缺失`，不下载。
5. 页面缺失（`query.pages` 空）→ `reasonCode "unsupported"`，消息含 `候选已不存在或不可用`。
6. `Content-Length > maxBytes` → `reasonCode "too-large"`，临时目录不存在。
7. 无 `Content-Length` 且两段累计超限 → 中止、`too-large`、临时目录不存在。
8. 空闲超时（注入 `idleTimeoutMs: 20`，流延迟 100ms）→ `timeout`，清理完成。
9. 总超时（注入 `totalTimeoutMs: 30`，流分多段慢速）→ `timeout`。
10. 第一次 503、第二次 200 → 成功且 fetch 次数断言为 2；每次重试不累加字节。
11. 三次 500 → `reasonCode "upstream"`，消息含 `下载失败`。
12. 对账不符（假 ingest 返回 `width` 与档位差 10px）→ `reasonCode "mismatch"`；预存 original/proxy 保留、本次新写删除（用真实临时 root + 预先放置同名文件/不放置两态断言）。
13. ingest 返回 `unsupported-format` → `reasonCode "unsupported"`；`decode-failed` → `"ingest"`；`store-error` → `"store-error"`。

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/media-store test`
Expected: 编译失败（模块不存在）。

- [ ] **Step 3: 最小实现**

顺序：W5 host 校验（先于任何 fetch）→ P1 metadata 重取（15s 超时）→ 许可/存在性校验 → P2 成员校验 → P3 流式下载到 `mkdtemp`（`AbortController` + 读流计时；`redirect:"error"`；UA）→ 读回 Buffer → P4 `ingest({bytes,fileName,root,origin})` → P5 对账（时长 ±1000ms、宽高 ±2px）→ P6 finally 清理。对账前用下载字节算 sha256 + `storeKeyFor` 记录 original/proxy 是否预存；不符时只删本次新写。消息逐字用 spec §3。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/media-store test`
Expected: 全绿（+12）。

- [ ] **Step 5: Commit**

```bash
git add packages/media-store/src/stock/import.ts packages/media-store/src/stock/import.test.ts packages/media-store/src/index.ts
git commit -m "feat(media-store): Wikimedia 候选下载/重试/超时/对账/清理编排"
```

---

### Task 4: 两条 web 路由

**Files:**
- Create: `apps/web/src/app/api/media/stock/search/route.ts`
- Create: `apps/web/src/app/api/media/stock/import/route.ts`

**Interfaces:**
- Consumes: `buildWikimediaSearchUrl` / `normalizeWikimediaPages`（Task 2）；`importStockCandidate`（Task 3）；`resolveStoreRoot`。
- Produces:
  - `GET /api/media/stock/search?q=` → `{ candidates: StockCandidate[] }`，错误 `{ error }`。
  - `POST /api/media/stock/import` body `{ pageTitle, derivativeUrl }` → `{ asset }`，错误 `{ error }`。

- [ ] **Step 1: 写 search 路由**

dev 门（503 `在线搜索仅在本地开发环境开放。`）；q trim 后空 → 400 `搜索关键词不能为空。`、>80 → 400 `搜索关键词过长（上限 80 字符）。`；`fetch(buildWikimediaSearchUrl(q), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) })`；非 200/JSON 解析失败 → 502 `在线素材检索失败：…（可重试或改用本地上传）`；成功 `Response.json({ candidates })`。

- [ ] **Step 2: 写 import 路由**

dev 门（503 `在线搜索仅在本地开发环境开放。`）+ 同源校验（403 `跨站请求已拒绝。`，照抄 `ingest/route.ts` 的 Origin 逻辑）；JSON 形状校验（400 `请求须为 JSON 且含 pageTitle 与 derivativeUrl。`）；调用 `importStockCandidate({ pageTitle, derivativeUrl, root: resolveStoreRoot() })`；状态映射 `too-large→413`、`unlicensed|mismatch|unsupported|ingest→422`、`upstream→502`、`timeout→504`、`store-error→500`；成功 `{ asset }`。

- [ ] **Step 3: 类型与构建检查**

Run: `pnpm --filter @acs/media-store build && pnpm --filter @acs/web run typecheck`
Expected: 零错。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/media/stock
git commit -m "feat(web): Wikimedia 检索与导入路由（dev 门/同源/状态码映射）"
```

---

### Task 5: 面板纯状态机 + 默认媒体草稿

**Files:**
- Create: `apps/web/src/app/video-studio/stock-search.ts`
- Create: `apps/web/src/app/video-studio/stock-search.test.ts`
- Modify: `apps/web/src/app/video-studio/media-clip-templates.ts`（新增 `mediaDraftForAsset`）
- Test: `apps/web/src/app/video-studio/media-clip-templates.test.ts`
- Modify: `apps/web/src/app/video-studio/media-assets.ts`（`assetLabel` 增 stock 分支）
- Test: `apps/web/src/app/video-studio/media-assets.test.ts`

**Interfaces:**
- Consumes: `import type { StockCandidate } from "@acs/media-store"`（**仅 type import**，客户端不得 value-import 该 Node 包）。
- Produces:
  ```ts
  export type StockRejectReason = "题材不符" | "文字画面" | "质量低" | "许可不明" | "其他";
  export type StockSearchPhase = "idle" | "searching" | "results" | "importing" | "error";
  export type StockSearchState = {
    phase: StockSearchPhase; query: string; candidates: StockCandidate[];
    rejected: Record<string, StockRejectReason>; selected: Record<string, string>;
    imported: string[]; error: string | null;
  };
  export function initialStockSearchState(): StockSearchState;
  export function startSearch(s: StockSearchState, query: string): StockSearchState;
  export function searchSucceeded(s: StockSearchState, candidates: StockCandidate[]): StockSearchState;
  export function searchFailed(s: StockSearchState, error: string): StockSearchState;
  export function selectDerivative(s: StockSearchState, pageTitle: string, url: string): StockSearchState;
  export function rejectCandidate(s: StockSearchState, pageTitle: string, reason: StockRejectReason): StockSearchState;
  export function unrejectCandidate(s: StockSearchState, pageTitle: string): StockSearchState;
  export function importStarted(s: StockSearchState, pageTitle: string): StockSearchState;
  export function importSucceeded(s: StockSearchState, pageTitle: string): StockSearchState;
  export function importFailed(s: StockSearchState, error: string): StockSearchState;
  export function canDownload(c: StockCandidate): { ok: true } | { ok: false; reason: string };
  export function effectiveDerivativeUrl(s: StockSearchState, c: StockCandidate): string | null;
  // media-clip-templates.ts
  export function mediaDraftForAsset(asset: MediaAsset): MediaEditDraft;
  ```
  `mediaDraftForAsset`：`inMsText "0"`、`outMsText String(Math.min(2000, durationMs))`、`fit "cover"`、`focalPercentText "50"`、`audio "mute"`。
  `assetLabel` 的 stock 分支：`「<displayTitle 或来源页>」 W×H · N.Ns · Wikimedia Commons · <作者> · <许可>`（无作者则省略作者段）；local-upload 分支逐字不变；同内容提示仍追加。

- [ ] **Step 1: 写失败测试**

`stock-search.test.ts`（8 条）：初始相位 / `startSearch` 清空旧候选与错误 / 成功进入 `results` 且保留拒绝与选择 / 失败保留旧候选并置 `error` / 选择档位写入 `selected` / 拒绝与撤销 / `importSucceeded` 写入 `imported` 且回 `results` / `canDownload` 对 `disabledReason` 返回原文。`media-clip-templates.test.ts`（+2）：默认草稿字段全值；时长 <2000 时 `outMsText` 取素材时长。`media-assets.test.ts`（+2）：stock 标签含 `Wikimedia Commons`/作者/许可且不含「本地上传」；无作者时不出现空段。

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/web test`
Expected: 编译/模块缺失失败。

- [ ] **Step 3: 最小实现**

纯函数、不可变更新（返回新对象，不 mutate 入参）；`effectiveDerivativeUrl` = `selected[title] ?? defaultDerivativeUrl ?? null`，但若该 URL 不在候选档位中则回退默认；`canDownload` 优先 `disabledReason`，再要求有有效档位。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/web test`
Expected: 全绿（+12）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/stock-search.ts apps/web/src/app/video-studio/stock-search.test.ts apps/web/src/app/video-studio/media-clip-templates.ts apps/web/src/app/video-studio/media-clip-templates.test.ts apps/web/src/app/video-studio/media-assets.ts apps/web/src/app/video-studio/media-assets.test.ts
git commit -m "feat(web): 在线素材面板状态机、资产默认媒体草稿与 stock 标签"
```

---

### Task 6: 单事务 `importStockForShot`

**Files:**
- Create: `apps/web/src/app/video-studio/stock-apply.ts`
- Create: `apps/web/src/app/video-studio/stock-apply.test.ts`

**Interfaces:**
- Consumes: `appendMediaAsset`；`mediaDraftForAsset` + `buildMediaRevisePatch`（Task 5）；`reviseWorkingVersion`（`@acs/video-document`）。
- Produces:
  ```ts
  export type ImportStockDeps = {
    requestImport: (pageTitle: string, derivativeUrl: string) => Promise<MediaAsset>;
    save: (document: VideoProject) => Promise<VideoProject>;
    newVersionId: () => string;
  };
  export function applyStockAsset(
    latest: VideoProject, shotId: string, asset: MediaAsset, newVersionId: string,
  ): { document: VideoProject; applied: boolean; message: string };
  export async function importStockForShot(
    latest: VideoProject, shotId: string, pageTitle: string, derivativeUrl: string,
    deps: ImportStockDeps,
  ): Promise<{ document: VideoProject; message: string }>;
  ```
  行为：`requestImport` → `applyStockAsset`（账本追加 + 默认媒体草稿 + 旁白沿用该镜头工作版本 → `reviseWorkingVersion`）→ `save` **一次** → 返回已保存文档。镜头不存在时只追加账本，`applied:false`，消息 `素材已入库；原镜头已不存在，请在镜头卡中选择`。

- [ ] **Step 1: 写失败测试（4 条）**

1. 成功：新文档含新资产、目标镜头新增工作版本且 `sceneSource.type === "media-clip"`、`inMs 0`、`outMs min(2000,duration)`、`fit cover`、`focalX 0.5`、`audio mute`；旁白沿用原值；`save` 恰好调用一次。
2. 最新文档里其他镜头的既有修订被保留（模拟下载期间的用户编辑）。
3. 镜头不存在：文档只多资产、`applied:false`、消息逐字。
4. `save` 抛错：`importStockForShot` 拒绝，且不返回文档（调用方据此不 `setEditor`）。

- [ ] **Step 2: 跑测试确认 RED**

Run: `pnpm --filter @acs/web test`
Expected: 模块缺失失败。

- [ ] **Step 3: 最小实现**

`applyStockAsset` 用 `appendMediaAsset` 得到 `withAsset`；目标镜头缺失则直接返回；否则 `buildMediaRevisePatch(mediaDraftForAsset(asset), withAsset.mediaAssets ?? [], 工作版本 narrationText)`，`error` 时抛出（默认值理论上不会失败，作为防御）；`importStockForShot` 只调一次 `deps.save`。

- [ ] **Step 4: 跑测试确认 GREEN**

Run: `pnpm --filter @acs/web test`
Expected: 全绿（+4）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/stock-apply.ts apps/web/src/app/video-studio/stock-apply.test.ts
git commit -m "feat(web): 在线素材单事务落盘（最新文档基线 + 只保存一次）"
```

---

### Task 7: 镜头卡内搜索面板与接线

**Files:**
- Create: `apps/web/src/app/video-studio/stock-search-panel.tsx`
- Modify: `apps/web/src/app/video-studio/shot-editor-card.tsx`（Props + 媒体臂素材下拉旁挂面板）
- Modify: `apps/web/src/app/video-studio/page.tsx`（`documentRef` + `importStockForShot` 处理器 + 传 prop）
- Modify: `apps/web/src/app/video-studio/video-studio.css`

**Interfaces:**
- `ShotEditorCardProps` 新增 `onImportStock: (pageTitle: string, derivativeUrl: string) => Promise<string>`（返回成功消息）。
- 面板 props：`{ disabled: boolean; onImportStock: (pageTitle: string, derivativeUrl: string) => Promise<string> }`。
- 页面处理器：`handleStockImport(pageTitle, derivativeUrl)`（内部调 `stock-apply.importStockForShot`，与模块函数同名不冲突）——`fetch("/api/media/stock/import", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({pageTitle, derivativeUrl})})` → `{asset}` / `{error}`；再调 `importStockForShot(documentRef.current, shotId, pageTitle, derivativeUrl, { requestImport, save: saveVideoProject, newVersionId: () => crypto.randomUUID() })`。

- [ ] **Step 1: 写面板组件**

`stock-search-panel.tsx`：`useState(initialStockSearchState)`；搜索按钮 → `startSearch` → `fetch("/api/media/stock/search?q=" + encodeURIComponent(query))` → `searchSucceeded/failed`；渲染候选卡（缩略图 `<img>`、`displayTitle`、作者、许可、时长/尺寸、来源页 `target="_blank" rel="noreferrer"`）、`disabledReason` 徽标、档位 `<select>`（`effectiveDerivativeUrl`）、「下载并应用」「不采用」；已拒绝折叠区可撤销。下载中禁用重复提交。

- [ ] **Step 2: 接镜头卡**

媒体臂素材 `<select>` 下方插入 `<StockSearchPanel disabled={!canEdit} onImportStock={onImportStock} />`；从 props 解构新回调。

- [ ] **Step 3: 接页面单事务**

`const documentRef = useRef<VideoProject | null>(null);` + `useEffect(() => { documentRef.current = editor?.document ?? null; }, [editor?.document]);`。处理器内：`setEditor(prev => prev ? {...prev, busy:true, message:null} : prev)` → 成功 `setEditor(prev => prev ? {...prev, document: saved, message, busy:false} : prev)`；失败同样用函数式更新复位 `busy` 并 rethrow 给面板行内展示。`onRevise`/保存路径不动。

- [ ] **Step 4: 样式与检查**

`video-studio.css` 增候选卡/缩略图/禁用徽标/拒绝区样式（沿用现有 class 命名风格）。Run: `pnpm --filter @acs/web run typecheck && npx biome check apps/web/src/app/video-studio apps/web/src/app/api/media/stock`.
Expected: 零错、biome clean。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/video-studio/stock-search-panel.tsx apps/web/src/app/video-studio/shot-editor-card.tsx apps/web/src/app/video-studio/page.tsx apps/web/src/app/video-studio/video-studio.css
git commit -m "feat(web): 镜头卡内 Wikimedia 搜索/选用/下载并应用面板"
```

---

### Task 8: 手工冒烟、全量回归与收口

**Files:**
- Create: `artifacts/video-studio-stock-source/evidence.md`（untracked，不入库）
- Modify: `AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md`（顶部新增本刀条目）
- Create: `artifacts/codex-review-video-studio-p2-media-t5.md`（Codex 交接单，入库）

- [ ] **Step 1: 全量回归**

```bash
pnpm --filter @acs/video-document run build && node --test "packages/video-document/dist/**/*.test.js"
pnpm --filter @acs/video-scene test
pnpm --filter @acs/media-store test        # 31 + 预计 27
pnpm --filter @acs/web test                # 168 + 预计 16
node --test scripts/video/*.test.mjs
pnpm --filter @acs/web run typecheck
pnpm --filter @acs/remotion-engine run typecheck
npx biome check .
wc -l artifacts/tts-usage.jsonl            # 34
```
Expected: 全绿、零错、biome clean、台账 34。任何数量偏差先查清再记录（沿 T4 先例：数量差异要写进证据与交接单）。

- [ ] **Step 2: 真实网络手工冒烟**

`pnpm --filter @acs/web dev` → 打开 `/video-studio` → 新建项目并用规划器生成 ≥1 镜头 → 镜头卡模板选「媒体镜头」→ 在线搜索 `clouds` → 选一条 CC BY-SA 候选、选 480p/720p webm → 下载并应用。证据记：候选 pageTitle/作者/许可、所选档位 URL、返回 asset 的 `storeKey/sha256/duration/width/hasAudio`、卡片是否自动应用、保存重开后信息是否在、浏览器预览是否可播。反证：用 curl 调 import 路由传外站 URL 与非成员 URL（带 `Origin: http://localhost:3000`），断言 422 中文错误、项目文件字节不变、仓内无新增账本资产。

- [ ] **Step 3: 终评**

按 `superpowers:requesting-code-review` 派只读 reviewer 覆盖本刀范围（spec/plan + 全部实现提交），重点：Review Focus 5 条、服务端信任边界、单事务、清理分寸、零网络测试真实性。修 Critical/Important；Minors 记入交接单。

- [ ] **Step 4: 收口文档**

CURRENT_STATE 顶部新增「2026-10-20 Video Studio P2.5-T5 Wikimedia 在线素材源」条目（交付项、提交链、评审结论、回归数量、证据、下一步 T6）；写 Codex 交接单（范围/核心不变量/可复跑命令/风险清单/延后 Minor/文件索引）。

- [ ] **Step 5: 最终验证与提交**

重跑 Step 1 全部命令；确认 `git status` 只含预期的文档/交接单改动，证据 untracked；提交：

```bash
git add AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md artifacts/codex-review-video-studio-p2-media-t5.md
git commit -m "docs(video-studio): P2.5-T5 收口——CURRENT_STATE 条目 + Codex 复核交接单"
```
不 push、不 merge；主检出由用户管理。
