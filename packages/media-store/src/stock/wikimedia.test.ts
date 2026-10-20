// P2.6-T5 W1-W6 纯适配器单测：零网络，合成 Commons `formatversion=2` 夹具。
import assert from "node:assert/strict";
import test from "node:test";
import type { StockCandidate } from "./types.js";
import {
  buildWikimediaSearchUrl,
  buildWikimediaVideoInfoUrl,
  findDerivative,
  isAllowedWikimediaAssetUrl,
  normalizeWikimediaPages,
} from "./wikimedia.js";

const ORIGINAL_URL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/Demo_clouds.webm";
const TRANSCODE_BASE =
  "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Demo_clouds.webm";
const URL_480 = `${TRANSCODE_BASE}/Demo_clouds.webm.480p.vp9.webm`;
const URL_720 = `${TRANSCODE_BASE}/Demo_clouds.webm.720p.vp9.webm`;

// 夹具形状以实测 Commons `formatversion=2` 为准（videoinfo/derivatives 均为数组）。
function videoInfo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    size: 12_345_678,
    width: 1920,
    height: 1080,
    duration: 12.5,
    url: ORIGINAL_URL,
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Demo_clouds.webm",
    mime: "video/webm",
    thumburl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Demo_clouds.webm/320px.jpg",
    extmetadata: {
      LicenseShortName: { value: "CC BY-SA 4.0" },
      Artist: {
        value:
          '<a href="//commons.wikimedia.org/wiki/User:Demo">Demo Author</a>',
      },
      LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
      AttributionRequired: { value: "true" },
    },
    derivatives: [
      {
        src: ORIGINAL_URL,
        type: 'video/webm; codecs="vp9, opus"',
        width: 1920,
        height: 1080,
        bandwidth: 2_000_000,
      },
      {
        src: URL_480,
        type: 'video/webm; codecs="vp9, opus"',
        transcodekey: "480p.vp9.webm",
        width: 854,
        height: 480,
        bandwidth: 500_000,
      },
      {
        src: URL_720,
        type: 'video/webm; codecs="vp9, opus"',
        transcodekey: "720p.vp9.webm",
        width: 1280,
        height: 720,
        bandwidth: 1_000_000,
      },
    ],
    ...overrides,
  };
}

function page(overrides: Record<string, unknown> = {}) {
  return {
    pageid: 1,
    ns: 6,
    title: "File:Demo clouds.webm",
    videoinfo: [videoInfo()],
    ...overrides,
  };
}

function response(...pages: unknown[]) {
  return { batchcomplete: "", query: { pages } };
}

function derivative(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    src: ORIGINAL_URL,
    type: 'video/webm; codecs="vp9, opus"',
    width: 1920,
    height: 1080,
    bandwidth: 2_000_000,
    ...overrides,
  };
}

function firstCandidate(...pages: unknown[]): StockCandidate {
  const result = normalizeWikimediaPages(response(...pages));
  assert.ok(result.ok, "归一化应成功");
  const [candidate] = result.candidates;
  assert.ok(candidate, "应至少有一个候选");
  return candidate;
}

test("buildWikimediaSearchUrl：filetype:video、namespace、limit、关键词编码、formatversion", () => {
  const url = buildWikimediaSearchUrl("  云 海 & sky  ");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://commons.wikimedia.org");
  assert.equal(parsed.pathname, "/w/api.php");
  const params = parsed.searchParams;
  assert.equal(params.get("action"), "query");
  assert.equal(params.get("generator"), "search");
  assert.equal(params.get("gsrsearch"), "filetype:video 云 海 & sky");
  assert.equal(params.get("gsrnamespace"), "6");
  assert.equal(params.get("gsrlimit"), "10");
  assert.equal(params.get("prop"), "videoinfo");
  assert.equal(params.get("viprop"), "url|size|mime|extmetadata|derivatives");
  assert.equal(params.get("viurlwidth"), "320");
  assert.equal(params.get("format"), "json");
  assert.equal(params.get("formatversion"), "2");
  // 编码后不得出现裸空格/裸 &，中文按 UTF-8 百分号编码。
  assert.ok(!url.includes(" "));
  assert.ok(url.includes("filetype%3Avideo"));
  assert.ok(url.includes("%E4%BA%91"));
  assert.ok(url.includes("%26"));
  assert.equal(
    new URL(buildWikimediaSearchUrl("x", 3)).searchParams.get("gsrlimit"),
    "3",
  );
});

test("buildWikimediaVideoInfoUrl：titles 编码与 prop=videoinfo", () => {
  const url = buildWikimediaVideoInfoUrl("File:Demo clouds.webm");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://commons.wikimedia.org");
  assert.equal(parsed.pathname, "/w/api.php");
  const params = parsed.searchParams;
  assert.equal(params.get("action"), "query");
  assert.equal(params.get("titles"), "File:Demo clouds.webm");
  assert.equal(params.get("prop"), "videoinfo");
  assert.equal(params.get("viprop"), "url|size|mime|extmetadata|derivatives");
  assert.equal(params.get("viurlwidth"), "320");
  assert.equal(params.get("formatversion"), "2");
  assert.ok(url.includes("titles=File%3ADemo+clouds.webm"));
});

test("正常归一化：displayTitle、durationMs、sourcePageUrl、thumbnailUrl", () => {
  const candidate = firstCandidate(page());
  assert.equal(candidate.sourceId, "wikimedia");
  assert.equal(candidate.pageTitle, "File:Demo clouds.webm");
  assert.equal(candidate.displayTitle, "Demo clouds");
  assert.equal(candidate.durationMs, 12500);
  assert.equal(candidate.width, 1920);
  assert.equal(candidate.height, 1080);
  assert.equal(candidate.mime, "video/webm");
  assert.equal(
    candidate.sourcePageUrl,
    "https://commons.wikimedia.org/wiki/File:Demo_clouds.webm",
  );
  assert.equal(
    candidate.thumbnailUrl,
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Demo_clouds.webm/320px.jpg",
  );
  assert.equal(candidate.disabledReason, undefined);
});

test("许可映射：LicenseShortName、Artist 去标签、usageNote 含许可 URL 与须署名", () => {
  const candidate = firstCandidate(page());
  assert.deepEqual(candidate.license, {
    name: "CC BY-SA 4.0",
    author: "Demo Author",
    usageNote: "https://creativecommons.org/licenses/by-sa/4.0 · 须署名",
  });
  assert.ok(candidate.license?.author?.includes("<a") === false);
  assert.ok(
    candidate.license?.usageNote?.includes(
      "https://creativecommons.org/licenses/by-sa/4.0",
    ),
  );
  assert.ok(candidate.license?.usageNote?.includes("须署名"));
});

test("无 LicenseShortName：license 为 null 且禁用原因「许可不明」", () => {
  const candidate = firstCandidate(
    page({
      videoinfo: [
        videoInfo({
          extmetadata: {
            Artist: { value: "Somebody" },
            LicenseUrl: { value: "https://example.com/license" },
          },
        }),
      ],
    }),
  );
  assert.equal(candidate.license, null);
  assert.equal(candidate.disabledReason, "许可不明");
  // 仍保留展示信息与已解析档位。
  assert.ok(candidate.thumbnailUrl);
  assert.equal(
    candidate.sourcePageUrl,
    "https://commons.wikimedia.org/wiki/File:Demo_clouds.webm",
  );
  assert.ok(candidate.derivatives.length > 0);
});

test("档位筛选：只留 webm/mov/mp4、剔除 ogv、estimatedBytes=bandwidth×秒", () => {
  const derivatives = [
    derivative(),
    derivative({
      src: URL_480,
      transcodekey: "480p.vp9.webm",
      width: 854,
      height: 480,
      bandwidth: 500_000,
    }),
    derivative({
      src: URL_720,
      transcodekey: "720p.vp9.webm",
      width: 1280,
      height: 720,
      bandwidth: 1_000_000,
    }),
    derivative({
      src: `${TRANSCODE_BASE}/Demo_clouds.webm.240p.ogv`,
      type: "video/ogg",
      transcodekey: "240p.ogv",
      width: 426,
      height: 240,
      bandwidth: 100_000,
    }),
    derivative({
      src: `${TRANSCODE_BASE}/Demo_clouds.webm.360p.mov`,
      type: "video/quicktime",
      transcodekey: "360p.mov",
      width: 640,
      height: 360,
      bandwidth: 300_000,
    }),
    derivative({
      src: `${TRANSCODE_BASE}/Demo_clouds.webm.2160p.vp9.webm`,
      transcodekey: "2160p.vp9.webm",
      width: 3840,
      height: 2160,
      bandwidth: 8_000_000,
    }),
  ];
  const candidate = firstCandidate(
    page({ videoinfo: [videoInfo({ derivatives })] }),
  );
  assert.deepEqual(
    candidate.derivatives.map((entry) => entry.container),
    ["mov", "webm", "webm", "webm"],
  );
  assert.ok(candidate.derivatives.every((entry) => entry.width <= 1920));
  assert.ok(!candidate.derivatives.some((entry) => entry.url.includes(".ogv")));
  assert.equal(candidate.derivatives[0]?.label, "360p");
  assert.equal(candidate.derivatives[0]?.mime, "video/quicktime");
  assert.equal(candidate.derivatives[3]?.label, "原片");
  const low = candidate.derivatives.find((entry) => entry.width === 854);
  assert.ok(low);
  assert.equal(low.container, "webm");
  assert.equal(low.mime, "video/webm");
  assert.equal(low.label, "480p");
  assert.ok(Math.abs((low.estimatedBytes ?? 0) - 6_250_000) <= 1);
});

test("默认档位：720p 在选 720p；去掉 720p 选 480p；只有 1080p 选 1080p", () => {
  const with720 = firstCandidate(page());
  assert.equal(with720.defaultDerivativeUrl, URL_720);

  const without720 = firstCandidate(
    page({
      videoinfo: [
        videoInfo({
          derivatives: [
            derivative(),
            derivative({
              src: URL_480,
              transcodekey: "480p.vp9.webm",
              width: 854,
              height: 480,
              bandwidth: 500_000,
            }),
          ],
        }),
      ],
    }),
  );
  assert.equal(without720.defaultDerivativeUrl, URL_480);

  const only1080 = firstCandidate(
    page({ videoinfo: [videoInfo({ derivatives: [derivative()] })] }),
  );
  assert.equal(only1080.defaultDerivativeUrl, ORIGINAL_URL);
});

test("全部档位超过 1920 长边：禁用原因且 derivatives 为空", () => {
  const derivatives = [
    derivative({
      src: `${TRANSCODE_BASE}/Demo_clouds.webm.2160p.vp9.webm`,
      transcodekey: "2160p.vp9.webm",
      width: 3840,
      height: 2160,
    }),
    derivative({
      src: `${TRANSCODE_BASE}/Demo_clouds.webm.1440p.vp9.webm`,
      transcodekey: "1440p.vp9.webm",
      width: 2560,
      height: 1440,
    }),
  ];
  const candidate = firstCandidate(
    page({
      videoinfo: [videoInfo({ derivatives, width: 3840, height: 2160 })],
    }),
  );
  assert.equal(candidate.disabledReason, "全部档位超过 1920 长边");
  assert.deepEqual(candidate.derivatives, []);
  assert.equal(candidate.defaultDerivativeUrl, undefined);
});

test("只有 ogv 档位：无受支持的分辨率档位", () => {
  const candidate = firstCandidate(
    page({
      videoinfo: [
        videoInfo({
          derivatives: [
            derivative({
              src: `${TRANSCODE_BASE}/Demo_clouds.webm.240p.ogv`,
              type: "video/ogg",
              transcodekey: "240p.ogv",
              width: 426,
              height: 240,
            }),
          ],
        }),
      ],
    }),
  );
  assert.equal(
    candidate.disabledReason,
    "无受支持的分辨率档位（仅 mp4/webm/mov）",
  );
  assert.deepEqual(candidate.derivatives, []);
});

test("时长 600.5s：超时长禁用；200ms 与 600s 边界放行", () => {
  const over = firstCandidate(
    page({ videoinfo: [videoInfo({ duration: 600.5 })] }),
  );
  assert.equal(over.disabledReason, "时长超出支持范围（200ms..10 分钟）");
  assert.equal(over.durationMs, 600_500);
  assert.ok(over.derivatives.length > 0);

  const tooShort = firstCandidate(
    page({ videoinfo: [videoInfo({ duration: 0.1 })] }),
  );
  assert.equal(tooShort.disabledReason, "时长超出支持范围（200ms..10 分钟）");

  const maxBoundary = firstCandidate(
    page({ videoinfo: [videoInfo({ duration: 600 })] }),
  );
  assert.equal(maxBoundary.disabledReason, undefined);

  const minBoundary = firstCandidate(
    page({ videoinfo: [videoInfo({ duration: 0.2 })] }),
  );
  assert.equal(minBoundary.disabledReason, undefined);
});

test("缺 videoinfo 的页面跳过；query.pages 缺失时结构化失败不抛栈", () => {
  const skipped = normalizeWikimediaPages({
    query: {
      pages: [
        page(),
        { pageid: 2, ns: 6, title: "File:No video.webp" },
        { pageid: 3, ns: 6, title: "File:Empty.webm", videoinfo: [] },
      ],
    },
  });
  assert.ok(skipped.ok);
  assert.equal(skipped.candidates.length, 1);
  assert.equal(skipped.candidates[0]?.pageTitle, "File:Demo clouds.webm");

  const malformed: unknown[] = [
    null,
    undefined,
    "x",
    42,
    {},
    { query: null },
    { query: {} },
    { query: { pages: null } },
    { query: { pages: {} } },
  ];
  for (const value of malformed) {
    assert.doesNotThrow(() => normalizeWikimediaPages(value));
    assert.deepEqual(normalizeWikimediaPages(value), {
      ok: false,
      error: "Wikimedia 响应不可解析",
    });
  }
});

test("isAllowedWikimediaAssetUrl：仅 https + 精确 host + commons 路径 + 无端口/凭据", () => {
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Demo_clouds.webm",
    ),
    true,
  );
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/320px-x.jpg",
    ),
    true,
  );
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "http://upload.wikimedia.org/wikipedia/commons/a/ab/x.webm",
    ),
    false,
  );
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "https://upload.wikimedia.org.evil.com/wikipedia/commons/x.webm",
    ),
    false,
  );
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "https://upload.wikimedia.org:8443/wikipedia/commons/x.webm",
    ),
    false,
  );
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "https://user:pass@upload.wikimedia.org/wikipedia/commons/x.webm",
    ),
    false,
  );
  assert.equal(
    isAllowedWikimediaAssetUrl(
      "https://upload.wikimedia.org/wikipedia/other/x.webm",
    ),
    false,
  );
  assert.equal(isAllowedWikimediaAssetUrl("not a url"), false);
});

test("findDerivative：精确相等命中，不同 URL 返回 null", () => {
  const candidate = firstCandidate(page());
  const hit = findDerivative(candidate, URL_720);
  assert.ok(hit);
  assert.equal(hit.width, 1280);
  assert.equal(hit.label, "720p");
  assert.equal(findDerivative(candidate, `${URL_720}?x=1`), null);
  assert.equal(findDerivative(candidate, `${URL_720}/`), null);
});

test('Artist 实体解码：&amp;/&quot; 还原为 &/"，不残留标签', () => {
  const candidate = firstCandidate(
    page({
      videoinfo: [
        videoInfo({
          extmetadata: {
            LicenseShortName: { value: "CC BY 4.0" },
            Artist: {
              value:
                '<a href="//commons.wikimedia.org/wiki/User:Demo">A &amp; B &quot;Q&quot;</a>',
            },
            LicenseUrl: {
              value: "https://creativecommons.org/licenses/by/4.0",
            },
          },
        }),
      ],
    }),
  );
  assert.equal(candidate.license?.author, 'A & B "Q"');
  assert.ok(candidate.license?.author?.includes("<") === false);
});
