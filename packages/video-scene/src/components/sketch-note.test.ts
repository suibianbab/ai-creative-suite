import assert from "node:assert/strict";
import test from "node:test";
import type { FrameContext } from "../registry.js";
import type { SvgNode } from "../svg.js";
import { sketchNote } from "./sketch-note.js";

// collect 为各组件测试私有惯例（bar/line/map/flow/stick 同款），不跨文件共享
function collect(node: SvgNode, tag: string, out: SvgNode[] = []): SvgNode[] {
  if (node.tag === tag) out.push(node);
  for (const child of node.children ?? []) collect(child, tag, out);
  return out;
}

const BASE = {
  title: "手绘要点",
  items: [{ text: "要点一", emphasis: "下划线" }],
  inkColor: "#2f2f2f",
  accentColor: "#e05a2b",
  writeMs: 400,
  drawMs: 420,
  staggerMs: 200,
};

function specWith(params: unknown) {
  return {
    componentId: "sketch-note",
    componentVersion: 1,
    params,
    seed: 1,
    background: "#ffffff",
    durationMs: 3000,
  };
}
function makeCtx(overrides: Partial<FrameContext> = {}): FrameContext {
  return {
    frame: 24,
    fps: 24,
    width: 1920,
    height: 1080,
    ...overrides,
  } as FrameContext;
}
// tMs = frame/fps×1000；at(770) → 770ms 等，测试全部走可整除断言值
const at = (tMs: number) =>
  sketchNote.render(
    specWith(BASE),
    makeCtx({ frame: (tMs / 1000) * 24 }) as never,
  );
// svg 内第 i 条目的文本节点（svg children = [标题, ...items]，文本同序）
const itemText = (root: SvgNode, i: number) => collect(root, "text")[i + 1]!;

test("校验表：越界/非法输入逐项拒绝（消息逐字）", () => {
  const cases: Array<[unknown, RegExp]> = [
    ["not-object", /sketch-note params 必须是对象/],
    [{ ...BASE, title: "x".repeat(41) }, /title 必须是 ≤40 个字符/],
    [{ ...BASE, items: [] }, /items 必须是 1\.\.5 个/],
    [
      {
        ...BASE,
        items: Array.from({ length: 6 }, () => ({
          text: "甲",
          emphasis: "无",
        })),
      },
      /items 必须是 1\.\.5 个/,
    ],
    [{ ...BASE, items: ["甲"] }, /items\[0\] 必须是对象/],
    [
      { ...BASE, items: [{ text: "", emphasis: "无" }] },
      /text 必须是 1\.\.12 个字符/,
    ],
    [
      { ...BASE, items: [{ text: "x".repeat(13), emphasis: "无" }] },
      /text 必须是 1\.\.12 个字符/,
    ],
    [
      { ...BASE, items: [{ text: "甲", emphasis: "框" }] },
      /emphasis 必须是 下划线\/圈\/无/,
    ],
    [{ ...BASE, writeMs: 199 }, /writeMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, drawMs: 6000.5 }, /drawMs 必须是 200\.\.6000 的整数/],
    [{ ...BASE, staggerMs: 119 }, /staggerMs 必须是 120\.\.1200 的整数/],
    [{ ...BASE, staggerMs: "200" }, /staggerMs 必须是 120\.\.1200 的整数/],
    [{ ...BASE, inkColor: "#12345" }, /inkColor 必须是 #rrggbb/],
    [{ ...BASE, accentColor: "red" }, /accentColor 必须是 #rrggbb/],
  ];
  for (const [params, pattern] of cases) {
    assert.throws(
      () => sketchNote.validateParams(params),
      pattern,
      `input: ${JSON.stringify(params).slice(0, 80)}`,
    );
  }
  // 合法最小输入不抛（返回原值）
  assert.equal(sketchNote.validateParams(BASE), BASE);
});

test("逐字写入：p<0 零字 / 中途部分字 / p≥1 全量 / 单字条目至少一字", () => {
  // 整数帧（真实 Remotion 帧域），进度取远离 ceil 刀口处：
  // 帧 3 → tMs=125 <delay 160 → 0 字；帧 7 → tMs≈291.7，p≈0.329，×4≈1.32 → 2 字；
  // 帧 14 → tMs≈583.3 > 160+400 → 全 4 字；帧 5 → tMs≈208.3，p≈0.121 → 单字 1 字
  const spec = specWith({
    ...BASE,
    items: [{ text: "四字文本", emphasis: "无" }],
  });
  const render = (frame: number) =>
    sketchNote.render(spec, makeCtx({ frame }) as never);
  assert.equal(itemText(render(3), 0).text, "");
  assert.equal(itemText(render(7), 0).text, "四字");
  assert.equal(itemText(render(14), 0).text, "四字文本");
  const single = specWith({
    ...BASE,
    items: [{ text: "词", emphasis: "无" }],
  });
  const one = sketchNote.render(single, makeCtx({ frame: 5 }) as never);
  assert.equal(itemText(one, 0).text, "词");
});

test("标题淡入：tMs=150 半透明、tMs≥300 全显", () => {
  const half = at(150);
  assert.ok(
    Math.abs((collect(half, "text")[0]!.attrs.opacity as number) - 0.5) < 1e-9,
  );
  const full = at(300);
  assert.equal(collect(full, "text")[0]!.attrs.opacity, 1);
});

test("下划线几何与双描：抖动点序逐字、相位差 π/2、dashoffset 分速", () => {
  // "要点一" 3 CJK → em=3、fontSize=40、width=120 → left=416/right=584/seg=21
  // 一遍 y = 290 + 3.2·sin(2π(2u))；二遍 y = 290 + 2.4·sin(2π(2u)+π/2)
  const root = at(770); // delay 160 + write 400 + draw 210 → p1=0.5、p2=130/420
  const paths = collect(root, "path");
  assert.equal(paths.length, 2);
  assert.equal(
    paths[0]!.attrs.d,
    "M 416.00,290.00 L 437.00,293.20 L 458.00,290.00 L 479.00,286.80 L 500.00,290.00 L 521.00,293.20 L 542.00,290.00 L 563.00,286.80 L 584.00,290.00",
  );
  assert.ok((paths[1]!.attrs.d as string).includes(" L 458.00,287.60"));
  assert.equal(paths[0]!.attrs["stroke-width"], 6);
  assert.equal(paths[0]!.attrs.stroke, "#e05a2b");
  assert.equal(paths[0]!.attrs["stroke-dashoffset"], 0.5);
  assert.equal(paths[1]!.attrs["stroke-dashoffset"], 0.6905); // 1−130/420
  assert.equal(paths[1]!.attrs.opacity, 0.8);
});

test("圈几何：rx 随文本宽、首点抖动值、闭环回到首点", () => {
  const one = specWith({ ...BASE, items: [{ text: "词", emphasis: "圈" }] });
  const r1 = sketchNote.render(one, makeCtx({ frame: 24 }) as never);
  const d1 = collect(r1, "path")[0]!.attrs.d as string;
  // rx = 40/2+34 = 54；k=0: θ=−0.4、j=4·sin(−1.2)=−3.728 → (546.30, 244.32)
  assert.ok(d1.startsWith("M 546.30,244.32"));
  assert.ok(d1.endsWith(" L 546.30,244.32")); // k=20 闭环（3θ 周期性）
  assert.equal(collect(r1, "path")[0]!.attrs["stroke-width"], 5);
  const four = specWith({
    ...BASE,
    items: [{ text: "四字文本", emphasis: "圈" }],
  });
  const r4 = sketchNote.render(four, makeCtx({ frame: 24 }) as never);
  // width=160 → rx=114 → k=0 x = 500+(114−3.728)·cos(−0.4) = 601.57
  assert.ok(
    (collect(r4, "path")[0]!.attrs.d as string).startsWith("M 601.57,244.32"),
  );
});

test("梯次与进度：item0 收笔 dashoffset 0、item2 描画中 0.9048 / 二遍 1", () => {
  const spec = specWith({
    ...BASE,
    items: [
      { text: "甲甲", emphasis: "下划线" },
      { text: "乙乙", emphasis: "下划线" },
      { text: "丙丙", emphasis: "下划线" },
    ],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 24 }) as never); // tMs=1000
  const paths = collect(root, "path");
  assert.equal(paths.length, 6); // 3 条目 × 双描
  assert.equal(paths[0]!.attrs["stroke-dashoffset"], 0); // item0 收笔 980ms
  assert.equal(paths[4]!.attrs["stroke-dashoffset"], 0.9048); // (1000−960)/420
  assert.equal(paths[5]!.attrs["stroke-dashoffset"], 1); // 二遍 1040ms 才起笔
});

test("无强调条目：零 path、文本仍逐字写入", () => {
  // 注意：BASE 条目是下划线——本测试必须换 emphasis 无 的 spec
  const spec = specWith({
    ...BASE,
    items: [{ text: "要点一", emphasis: "无" }],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 13.44 }) as never); // tMs=560
  assert.equal(collect(root, "path").length, 0);
  assert.equal(itemText(root, 0).text, "要点一");
});

test("增补平面字符：emoji 按码点计数不劈半", () => {
  const spec = specWith({
    ...BASE,
    items: [{ text: "😀😀", emphasis: "无" }],
  });
  // 整数帧 7 → tMs≈291.7，p≈0.329 → ceil(0.66)=1 字（码点切半会得乱码代理项）
  const root = sketchNote.render(spec, makeCtx({ frame: 7 }) as never);
  assert.equal(itemText(root, 0).text, "😀");
});

test("tMs=0 边界：标题零透明、条目零字、无 transform 组、全树无 NaN", () => {
  const spec = specWith({
    ...BASE,
    items: [
      { text: "甲", emphasis: "下划线" },
      { text: "乙", emphasis: "圈" },
      { text: "丙", emphasis: "无" },
    ],
  });
  const root = sketchNote.render(spec, makeCtx({ frame: 0 }) as never);
  assert.equal(collect(root, "text")[0]!.attrs.opacity, 0);
  assert.equal(itemText(root, 0).text, "");
  assert.equal(
    collect(root, "g").filter((g) => "transform" in g.attrs).length,
    0,
  ); // 条目组无 transform（纵向定位由 itemY 直接写入坐标，非 translate 组）
  assert.equal(collect(root, "text").length, 4); // 标题 + 3 条目
  assert.equal(JSON.stringify(root).includes("NaN"), false);
});

test("帧确定性：同 spec 同 ctx 双调 deepEqual", () => {
  const spec = specWith({
    ...BASE,
    items: [
      { text: "混排甲", emphasis: "下划线" },
      { text: "混排乙", emphasis: "圈" },
    ],
  });
  const ctx = makeCtx({ frame: 17.28 });
  assert.deepEqual(
    sketchNote.render(spec, ctx as never),
    sketchNote.render(spec, ctx as never),
  );
});
