// P3-A 交互交付：自包含逐步播放器 HTML 构建器单测（纯字符串进出，零文件系统）。

import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerHtml, MAX_HTML_BYTES } from "./interactive-player.mjs";

const TWO_STEPS = [
  { svg: "<svg><text>一</text></svg>" },
  { svg: "<svg><text>二</text></svg>" },
];

function player(overrides = {}) {
  return buildPlayerHtml({
    title: "示例",
    width: 1280,
    height: 720,
    steps: TWO_STEPS,
    ...overrides,
  });
}

function readStepsData(html) {
  const match = html.match(
    /<script type="application\/json" id="steps-data">([\s\S]*?)<\/script>/,
  );
  assert.ok(match, "应能截取 steps-data 数据块");
  return JSON.parse(match[1]);
}

test("输出文档骨架：doctype、lang、data-total、标题转义与固定文案", () => {
  const html = player({ title: "云 & 雨" });
  assert.ok(html.includes("<!doctype html>"));
  assert.ok(html.includes('lang="zh-CN"'));
  assert.ok(html.includes('data-total="2"'));
  assert.ok(html.includes("<title>云 &amp; 雨</title>"));
  assert.ok(!html.includes("<title>云 & 雨</title>"));
  assert.ok(html.includes(">上一步</button>"));
  assert.ok(html.includes(">下一步</button>"));
  assert.ok(html.includes(">重新开始</button>"));
  assert.ok(html.includes(">第 1 / 2 步</span>"));
});

test("数据块把 < 转义为 \\u003c：不提前闭合脚本且 JSON 可取回原串", () => {
  const raw = "<svg><text>a</text></svg></script>";
  const html = player({ steps: [{ svg: raw }] });
  assert.ok(!html.includes("</script></script>"));
  assert.ok(!html.includes(raw), "原始 SVG 不应逐字出现在输出中");
  const data = readStepsData(html);
  assert.equal(data.steps[0].svg, raw);
  assert.equal(data.title, "示例");
  assert.equal(data.width, 1280);
  assert.equal(data.height, 720);
});

test("自包含：无外部引用、无网络 API", () => {
  const html = player();
  for (const token of ["src=", "href=", "<link", "fetch(", "XMLHttpRequest"])
    assert.ok(!html.includes(token), `输出不应包含 ${token}`);
});

test("确定性：同输入两次调用逐字节一致", () => {
  assert.equal(player(), player());
  assert.equal(
    player({ title: "云 & 雨", steps: TWO_STEPS }),
    player({ title: "云 & 雨", steps: TWO_STEPS }),
  );
});

test("重新开始与 Home 强制重渲染第 1 步（已在第 1 步也重启动画）", () => {
  const html = player();
  assert.match(
    html,
    /const reset = \(\) => \{\s*index = 0;\s*render\(\);\s*\};/,
  );
  assert.match(html, /restart\.addEventListener\("click", reset\);/);
  assert.match(
    html,
    /event\.key === "Home"\)\s*\{\s*event\.preventDefault\(\);\s*reset\(\);/,
  );
  assert.ok(!html.includes("go(0)"), "重新开始不应经过 go() 的等值早退");
});

test("边界：0 步与体积超限均抛出可定位的中文错误", () => {
  assert.equal(MAX_HTML_BYTES, 8 * 1024 * 1024);
  assert.throws(() => player({ steps: [] }), /步骤数为 0/);
  assert.throws(
    () => player({ steps: [{ svg: `<svg>${"x".repeat(MAX_HTML_BYTES)}` }] }),
    /页面体积超限/,
  );
});

test("非法输入：缺失 svg 与非法宽高均报出定位文案", () => {
  assert.throws(() => player({ steps: [{ svg: 1 }] }), /第 1 步.*svg/);
  assert.throws(() => player({ width: 0 }), /宽度/);
  assert.throws(() => player({ height: Number.NaN }), /高度/);
  assert.throws(() => player({ title: undefined }), /标题/);
});
