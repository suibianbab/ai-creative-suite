import assert from "node:assert/strict";
import test from "node:test";
import type { SceneSpec } from "@acs/video-scene";
import {
  applyLoadingTemplate,
  buildLoadingRevisePatch,
  draftLoadingFromSpec,
  isLoadingComponentId,
  LOADING_TEMPLATES,
  type LoadingEditDraft,
} from "./loading-templates";

function baseSpec(): SceneSpec {
  return {
    specVersion: 1,
    componentId: "text-animation",
    componentVersion: 1,
    params: {},
    seed: 7,
    background: "#f7f5f2",
    durationMs: 2000,
  } as SceneSpec;
}

test("5 枚模板全部过 validateSceneSpec 且预算不变量成立（cycle ≤1200 / progress ≤2000）", () => {
  for (const template of LOADING_TEMPLATES) {
    const applied = applyLoadingTemplate(baseSpec(), template.templateId);
    assert.equal(applied.error, null, template.templateId);
    assert.ok(applied.spec);
    const params = applied.spec!.params as Record<string, unknown>;
    if (template.componentId === "loading-dots") {
      assert.ok((params.cycleMs as number) <= 1200, template.templateId);
    } else {
      assert.ok((params.progressMs as number) <= 2000, template.templateId);
    }
  }
});

test("未知 templateId 报错；structuredClone 隔离两次应用", () => {
  const bad = applyLoadingTemplate(baseSpec(), "loading-nope");
  assert.equal(bad.spec, null);
  assert.equal(bad.error, "未知加载模板 loading-nope");
  const a = applyLoadingTemplate(baseSpec(), "loading-dots-3");
  const b = applyLoadingTemplate(baseSpec(), "loading-dots-3");
  assert.ok(a.spec && b.spec);
  assert.notEqual(a.spec!.params, b.spec!.params);
  (a.spec!.params as { dots: number }).dots = 6;
  assert.equal((b.spec!.params as { dots: number }).dots, 3);
});

test("round-trip：dots ↔ count、progress ↔ target，另一字段空串", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  assert.deepEqual(draftLoadingFromSpec(dotsSpec), {
    title: "加载等待",
    label: "加载中",
    count: "3",
    target: "",
  } satisfies LoadingEditDraft);
  const ringSpec = applyLoadingTemplate(baseSpec(), "loading-ring-72").spec!;
  assert.deepEqual(draftLoadingFromSpec(ringSpec), {
    title: "加载进度",
    label: "加载资料",
    count: "",
    target: "72",
  } satisfies LoadingEditDraft);
});

test("buildLoadingRevisePatch：dots 改 count/label、progress 改 target/label 落 params", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  const dotsNext = buildLoadingRevisePatch(dotsSpec, {
    title: "等待画面",
    label: "正在加载",
    count: "4",
    target: "",
  });
  assert.equal(dotsNext.error, null);
  const dotsParams = dotsNext.spec!.params as Record<string, unknown>;
  assert.equal(dotsParams.dots, 4);
  assert.equal(dotsParams.label, "正在加载");
  assert.equal(dotsParams.title, "等待画面");
  // 合并保留：colors/cycleMs 不被编辑丢弃
  assert.equal(dotsParams.cycleMs, 720);
  assert.equal(dotsParams.accentColor, "#e05a2b");

  const ringSpec = applyLoadingTemplate(baseSpec(), "loading-ring-72").spec!;
  const ringNext = buildLoadingRevisePatch(ringSpec, {
    title: "加载进度",
    label: "同步数据",
    count: "",
    target: "85",
  });
  assert.equal(ringNext.error, null);
  const ringParams = ringNext.spec!.params as Record<string, unknown>;
  assert.equal(ringParams.targetPercent, 85);
  assert.equal(ringParams.label, "同步数据");
  assert.equal(ringParams.progressMs, 1600);
});

test("解析错误表：label 空/超长、count/target 非法——行内错误不落 patch", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  const ringSpec = applyLoadingTemplate(baseSpec(), "loading-ring-72").spec!;
  const cases: Array<[SceneSpec, LoadingEditDraft, string]> = [
    [
      dotsSpec,
      { title: "t", label: "", count: "3", target: "" },
      "状态文案必须是 1..12 个字符",
    ],
    [
      dotsSpec,
      {
        title: "t",
        label: "一二三四五六七八九十甲乙丙",
        count: "3",
        target: "",
      },
      "状态文案必须是 1..12 个字符",
    ],
    [
      dotsSpec,
      { title: "t", label: "加载中", count: "", target: "" },
      "点数必须是 3..6 的整数",
    ],
    [
      dotsSpec,
      { title: "t", label: "加载中", count: "7", target: "" },
      "点数必须是 3..6 的整数",
    ],
    [
      dotsSpec,
      { title: "t", label: "加载中", count: "4.5", target: "" },
      "点数必须是 3..6 的整数",
    ],
    [
      dotsSpec,
      { title: "t", label: "加载中", count: "４", target: "" },
      "点数必须是 3..6 的整数",
    ],
    [
      ringSpec,
      { title: "t", label: "加载中", count: "", target: "" },
      "目标百分比必须是 1..100 的整数",
    ],
    [
      ringSpec,
      { title: "t", label: "加载中", count: "", target: "0" },
      "目标百分比必须是 1..100 的整数",
    ],
    [
      ringSpec,
      { title: "t", label: "加载中", count: "", target: "101" },
      "目标百分比必须是 1..100 的整数",
    ],
    [
      ringSpec,
      { title: "t", label: "加载中", count: "", target: "8x" },
      "目标百分比必须是 1..100 的整数",
    ],
  ];
  for (const [spec, draft, message] of cases) {
    const result = buildLoadingRevisePatch(spec, draft);
    assert.equal(result.spec, null, message);
    assert.equal(result.error, message);
  }
});

test("非加载组件拒绝", () => {
  const result = buildLoadingRevisePatch(baseSpec(), {
    title: "t",
    label: "加载中",
    count: "3",
    target: "",
  });
  assert.equal(result.spec, null);
  assert.equal(result.error, "当前镜头组件不是加载组件");
});

test("title 边界：41 字被 validateSceneSpec 拒（组件消息透传）", () => {
  const dotsSpec = applyLoadingTemplate(baseSpec(), "loading-dots-3").spec!;
  const result = buildLoadingRevisePatch(dotsSpec, {
    title: "a".repeat(41),
    label: "加载中",
    count: "3",
    target: "",
  });
  assert.equal(result.spec, null);
  assert.ok(result.error!.includes("title"));
});

test("isLoadingComponentId：两组件 id 命中、其余不命中", () => {
  assert.ok(isLoadingComponentId("loading-dots"));
  assert.ok(isLoadingComponentId("loading-progress"));
  assert.ok(!isLoadingComponentId("sketch-note"));
  assert.ok(!isLoadingComponentId("bar-chart"));
});
