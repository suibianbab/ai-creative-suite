# Codex 复核交接 —— `worktree-video-studio-p2`（P2.5-T2：媒体导入与内容寻址媒体仓）

- 日期：2026-10-19
- 工作树：`D:\codex\animate\.claude\worktrees\video-studio-p0`（分支 `worktree-video-studio-p2`；**主检出 `D:\codex\animate` 由用户管理，勿动**）
- 范围：`335de8f..1a0537a`（13 提交：spec/plan/5 任务 + 终评修复 6）。`335de8f` 为 T1 收口点（上次复核范围的后续基线；T1 复核若仍在途以 `855170c..72d6b10` 为准）
- 纪律：工作树内只读复核；**不要 push / merge / 改 HEAD**（集成由用户决定）；本刀**零 e2e、零浏览器**（CLI/路由均单测覆盖，真实 ffmpeg/ffprobe 允许）；`artifacts/tts-usage.jsonl` 台账 34 行不变（零计费路径）；媒体不入库约定不变
- 回写约定：结论写 **`artifacts/codex-review-video-studio-p2-media-t2-result.md`**（勿覆盖本交接单）；格式沿 T1 版（Review Focus 逐项 / Rulings 判定 / Declined 逐条 / Issues C-I-M / Ready to merge + reasoning）

## 一、提交链（13 提交，spec → plan → 5 任务 TDD → 终评修复通）

| 提交 | 内容 |
|---|---|
| `6d592e7` | spec：§0 现状锚点 · §1 CLI+双路由 · §1.1 导入管线与 reasonCode 六码 · §2 规则表 P/S/D/W · §4 兼容 · §5 测试清单 · §6 非目标 · §7 验收 |
| `6768d5a` | plan：5 任务全 TDD 代码 + Global Constraints + Review Focus 5 条 + spec→plan 四项精化（reasonCode/注入位/导出形状） |
| `c055c6a` | Task 1 store S 表：storeKey 形状门/resolveStoreRoot/writeAtomically 原子+幂等（6 测试） |
| `769a5b3` | Task 2 probe P 表：parseProbeOutput 纯解析 + runProbe ENOENT 中文（8 测试） |
| `5757ee4` | Task 3 proxy W 表：needsProxy/transcodeProxy + W3 自核验 + ffmpeg 版本 note（4 测试） |
| `e864725` | Task 4 ingest：D1 解码门/P6 时长/W2 回滚分寸/reasonCode（7 测试；**TDD 抓真缺陷**：ffmpeg 不建输出父目录→transcodeProxy 内 mkdirSync） |
| `56cc17c` | Task 5 CLI + Next 双路由 + web 接线（CLI 3 + 路由 6 测试；glob 扩展捞回 11 条旧 api 测试收编） |
| `eb03365` | **终评 F4**：probe/decode/transcode 异步化（spawnSync 冻结 Next 事件循环） |
| `77960cb` | **终评 F1**：isEnoentError 分类 + 转码失败空 stderr 补诊断 |
| `60f1c2d` | **终评 F2**：fileName>200 入口拒 + proxy.note 契约边界截 200 |
| `ec1e1c4` | **终评 F3**：有效预存代理复用（对称 S3） |
| `e53d010` | **终评 F6**（Minor 上调）：CLI 读文件/仓根失败中文 exit 1 |
| `1a0537a` | biome 格式收口（复跑全量电池） |

## 二、核心判据（可挑战的不变量）

1. **包边界**：`@acs/media-store` Node-only——浏览器永不 import（video-document 仍是浏览器面契约；`apps/web` 仅服务端路由引它）。若发现任何 client 组件链上引用即为违约。
2. **内容寻址不变量**：storeKey=`sha256 前 16 位 hex + .mp4/.webm/.mov`；同 storeKey 同大小 → 幂等复用不重写（mtime 不变）；大小不符 → 大声拒「内容寻址冲突」（16 hex 截断碰撞的代价由 T1 契约接受）；形状门同时是路径穿越门（`../`/反斜杠/大写/错扩展名全拒，GET 400）。
3. **D1 解码门语义**：`-v error -f null` 全片解码，**退出码 0 且 stderr 干净**才算过——退出码 0 ≠ 成功（stderr 有坏帧行也拒）。「截断 40% 残片」测试接受 probe-failed 或 decode-failed 二者之一（探针可能先拒）。
4. **W2 回滚分寸**：转码失败仅删**本次新写**的 original（`wroteOriginal && !existedBefore` 才 unlink）；预存同 storeKey 文件背后是既有账本资产，无权销毁。**F3 修复后代理侧同分寸**：有效预存代理（探测过 + 长边 ≤1280）直接复用不重转码——重传重编码不但烧 CPU，`-y` 覆盖遇瞬时失败还会毁掉预存代理。
5. **异步化边界（F4）**：`runCapture` 手动累积 stdout/stderr——无 spawnSync maxBuffer（1 MiB）上限，坏文件海量 stderr 不再变 ENOBUFS 假 ENOENT；注入位类型 `T | Promise<T>`，既有同步测试假件零改动。事件循环测试：导入执行中 `setImmediate` 必须有机会跑。
6. **路由安全面**：POST 仅 development 开放（503）/ Origin 校验（403）/ content-length>500MB（413）/ multipart 门（400）/ reasonCode→HTTP 映射（415/422/500）——**永不写项目文档**（账本写入是 T3 的事）；GET 形状 400 → original→proxy 回退 200 → 404，Range 206/416 流式。POST 无 Origin 放行沿 image-local-edit 先例（全仓立场，非本刀引入）。
7. **reasonCode 六码是 spec §1.1 封闭集合**：fileName>200 拒收复用 `unsupported-format`（415）是裁定不是偷懒——加第 7 码越权（终评 Ruling，欢迎挑战）。

## 三、可复跑验证命令（期望输出）

```bash
cd D:/codex/animate/.claude/worktrees/video-studio-p0

# 单测（须先 build 依赖链）
pnpm run build
pnpm --filter @acs/media-store test        # 31 pass（25 任务 + 6 终评；含真实 ffmpeg 转码夹具）
pnpm --filter @acs/video-document test     # 104 pass（零改动回归）
pnpm --filter @acs/video-scene test        # 131 pass（零改动回归）
pnpm --filter @acs/web test                # 143 pass（6 新路由 + 11 收编旧 api + 126 基线）
node --test scripts/video/*.test.mjs       # 全绿（media-ingest CLI 5/5 含 F6 两枚）

# 静态
pnpm -r typecheck                          # 零错
npx biome check .                          # 零问题

# 台账
wc -l artifacts/tts-usage.jsonl            # 34（本刀零计费）

# CLI 手感（可选；写临时目录不碰默认仓）
node scripts/video/media-ingest.mjs --file <任一mp4> --store "$TEMP/t2-check"   # stdout MediaAsset JSON
node scripts/video/media-ingest.mjs --file nope.mp4 --store "$TEMP/t2-check"    # exit 1 + stderr「无法读取文件：…」
```

无 e2e（T6 才有 VID-023）；无浏览器路径。

## 四、给 Codex 的检查清单（按风险排序）

1. **F3 复用判定的完备性**（`ec1e1c4`）：复用条件 = existsSync + probeFn 过 + 长边 ≤1280。预存代理**时长漂移**未复核（同 storeKey ⇒ 同源内容 ⇒ 创建时已 <500ms，论证见 ledger；**请独立判断是否够**）。复用 note=`复用仓内既有代理 <stem>`——原配方指纹不可复原（note 只存账本资产不落仓），欢迎挑战该裁定。
2. **F2 截断语义**：`proxy.note` 截 200 在 buildAsset 契约边界（覆盖注入转码器与复用两来路）；fileName>200 在入口拒——截断 vs 拒收的取舍是否认可（我方：截断失真不如拒收大声）。
3. **异步化的资源面**：`runCapture` 无上限累积 stderr——病态文件（10 分钟全坏帧）stderr 可到数十 MB 字符串驻留；接受论据：进程生命周期短、原 spawnSync 同样会 ENOBUFS 崩。**请独立判断是否需要上限**。
4. **GET 流式正确性**：Range 解析 `bytes=(\d*)-(\d*)`——start 锚定/开放端正确；后缀段（`bytes=-100`）按前缀处理、多段/垃圾 416 而非 RFC 的忽略回 200（F5，缓办 Minor——浏览器 video 元素不发这些形态）；零字节文件 `bytes=0-` 416（RFC 允许，仓内文件恒非空——探测门保证）。
5. **W2 场景 B 与幂等的交互**：预存 original + 转码失败 → 预存不动但 ingest 返回 proxy-failed（调用方视角资产导入失败，预存资产不受影响）——语义是否自洽。
6. **测试红绿真实性**：终评 6 枚修复各见证 RED（F4 setImmediate 冻结、F1 TS2305+空细节、F2 双枚、F3 转码器被调即抛、F6 双枚——第二枚初写松弛〔栈倾倒恰含中文即过〕收紧禁栈帧后重证 RED——该教训已记 CURRENT_STATE）。

## 五、评审裁定摘要（欢迎挑战）

- **F4 判 Important 并入修复通**（评审人原话「confirm with plan owner」）：主用例是实拍长片（分钟级），冻结 dev server 全部路由+HMR 不可接受；异步化后注入位零破坏、套件全绿——若认为该属计划层决策应留 T3，请标注。
- **F6 由 Minor 上调修复**：spec §1 明文「失败 exit 1 + stderr 中文」——打错 `--file` 路径是最常见失败形态，属契约违约非打磨。
- 评审 Declined 12 条维持置评（无 Origin POST=全仓先例 / GET 无环境门=spec §1.2 有意 / 分块绕 413=spec 逐字 / e2e 相对路径=T6 解析职责 / x264 线程漂移=T4 assetDigests 范围 / 64 位截断与 r_frame_rate=spec 明文 / T3 UI 缺失=§5 非目标）。
- 执行期 Ruling（plan 自审漏过的测试代码缺陷 ×3：Windows 动态 import pathToFileURL、零残留断言独立仓目录 ×2、NODE_ENV/BlobPart 类型先例绕行）已被终评逐条核对成立。

## 六、延后 Minor 台账（未修，不阻塞）

- **F5** Range 后缀段按前缀处理、多段/垃圾 416 而非忽略回 200（浏览器不发这些形态）。
- **F7** 代理直写最终路径非原子（无 tmp+rename）——硬杀残留半成品可被 GET 200 流出；F3 复用探测使下次导入自愈重转。
- **F8** `cleanup()` rmSync 遇 Windows EPERM（杀毒/索引器锁）会把 `{ok:false}` 变 reject → 路由 500 丢中文语义（edge）。
- **F9** GET 先查仓根（500）后查形状（400）——仅 ACS_MEDIA_STORE 相对 + 坏 storeKey 双误配可达。
- P1/P2 期旧台账（dataviz 9 条、themes 各刀、T1 四条一行断言）仍在册。

## 七、关键文件索引

- spec/plan：`docs/superpowers/{specs,plans}/2026-10-19-video-studio-media-ingest-store*.md`
- 包：`packages/media-store/src/{store,probe,proxy,ingest}.ts` + 同名 .test.ts（31 测试）
- CLI：`scripts/video/media-ingest.mjs` + `media-ingest.test.mjs`（5 测试）
- 路由：`apps/web/src/app/api/media/ingest/route.ts` + `file/[storeKey]/route.ts` + 两个 route.test.ts
- 状态：`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 顶部条目（T2）
- P2.5 总纲：`docs/VIDEO_STUDIO_OPENMONTAGE_ADOPTION_2026-10-19.md` + `docs/VIDEO_STUDIO_MEDIA_MIX_REVISION_2026-10-19.md`
