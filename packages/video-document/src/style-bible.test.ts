import assert from "node:assert/strict";
import test from "node:test";
import { reviseWorkingVersion } from "./operations.js";
import {
  applyStyleBible,
  assertStyleBibleEvolution,
  resolveStyleBibleRef,
  styleSceneSpec,
  styleVersionDigest,
  validateStyleBible,
  workingStyleIssues,
} from "./style-bible.js";
import type { StyleBible, VideoProject } from "./types.js";
import { validateVideoProject } from "./validate.js";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const ID4 = "44444444-4444-4444-8444-444444444444";
const AT = "2026-10-22T00:00:00.000Z";

const bible: StyleBible = {
  schemaVersion: 1,
  id: ID,
  currentVersionId: ID2,
  versions: [
    {
      versionId: ID2,
      createdAt: AT,
      name: "深蓝暖金",
      palette: {
        background: "#101820",
        foreground: "#f3e6cf",
        secondary: "#e8b04b",
        accent: "#e8b04b",
        object: "#c98548",
      },
      fontFamily: "NotoSansSC",
      lightingPreset: "orbit3d-fixed-soft-studio",
    },
  ],
};

function sample(): VideoProject {
  return {
    schemaVersion: 1,
    id: ID3,
    title: "style sample",
    savedVersion: 1,
    brief: { sentence: "four shots", aspectTargets: ["landscape"] },
    shots: [0, 1].map((order) => ({
      shotId: order ? ID4 : ID2,
      order,
      locked: false,
      workingVersionId: order ? ID4 : ID2,
      contentVersions: [
        {
          versionId: order ? ID4 : ID2,
          createdAt: AT,
          durationMs: 1000,
          description: "initial",
          narrationText: "",
          sceneSource: {
            type: "spec" as const,
            spec: {
              specVersion: 1,
              componentId: "text-animation",
              componentVersion: 1,
              durationMs: 1000,
              seed: order,
              background: "#ffffff",
              params: {
                title: `shot ${order}`,
                titleColor: "#000000",
                subtitleColor: "#555555",
                entrance: "fade-up",
                enterMs: 400,
              },
            },
          },
          provenance: { engineId: "planner-rules", engineVersion: "1" },
        },
      ],
      events: [
        {
          kind: "submitted" as const,
          versionId: order ? ID4 : ID2,
          at: AT,
          actor: "human" as const,
        },
      ],
    })),
    renderRecords: [],
    deliveries: [],
  };
}

test("Style Bible 独立版本校验、摘要与旧版本只追加", async () => {
  validateStyleBible(bible);
  const bad = structuredClone(bible);
  bad.versions[0]!.fontFamily = "NotoSansSC";
  bad.versions[0]!.palette.background = "white";
  assert.throws(() => validateStyleBible(bad), /palette/);
  const next = structuredClone(bible);
  next.versions.push({
    ...structuredClone(bible.versions[0]!),
    versionId: ID3,
    name: "v2",
  });
  next.currentVersionId = ID3;
  assertStyleBibleEvolution(bible, next);
  next.versions[0]!.palette.background = "#000000";
  assert.throws(() => assertStyleBibleEvolution(bible, next), /不可改写/);
  assert.match(await styleVersionDigest(bible.versions[0]!), /^[0-9a-f]{64}$/);
});

test("应用风格仅追加镜头内容版本，项目只留引用；重开与单镜头修订维持风格", async () => {
  const source = sample();
  validateVideoProject(source);
  const ids = [ID, ID3];
  const styled = await applyStyleBible(
    source,
    bible,
    ID2,
    () => ids.shift()!,
    AT,
  );
  assert.equal(styled.shots[0]!.contentVersions.length, 2);
  assert.equal(styled.shots[1]!.contentVersions.length, 2);
  assert.equal(
    (
      source.shots[0]!.contentVersions[0]!.sceneSource as {
        spec: { background: string };
      }
    ).spec.background,
    "#ffffff",
  );
  assert.deepEqual(Object.keys(styled.styleBibleRef!).sort(), [
    "bibleId",
    "digest",
    "versionId",
  ]);
  const reopened = validateVideoProject(JSON.parse(JSON.stringify(styled)));
  const resolved = await resolveStyleBibleRef(reopened.styleBibleRef!, bible);
  assert.equal(resolved.name, "深蓝暖金");
  assert.deepEqual(workingStyleIssues(reopened, resolved), []);
  const first = reopened.shots[0]!;
  const spec = structuredClone(
    (
      first.contentVersions.at(-1)!.sceneSource as {
        spec: Record<string, unknown>;
      }
    ).spec,
  );
  (spec.params as Record<string, unknown>).title = "new title";
  const edited = reviseWorkingVersion(
    reopened,
    first.shotId,
    { spec },
    "55555555-5555-4555-8555-555555555555",
    AT,
  );
  assert.deepEqual(workingStyleIssues(edited, resolved), []);
  assert.deepEqual(edited.shots[1], reopened.shots[1]);
  const drift = structuredClone(edited);
  (
    drift.shots[0]!.contentVersions.at(-1)!.sceneSource as {
      spec: { background: string };
    }
  ).spec.background = "#ff0000";
  assert.match(workingStyleIssues(drift, resolved).join(""), /镜头 1/);
});

test("摘要错配拒绝，旧项目无风格引用仍可读取", async () => {
  assert.equal(validateVideoProject(sample()).styleBibleRef, undefined);
  const digest = await styleVersionDigest(bible.versions[0]!);
  await assert.rejects(
    resolveStyleBibleRef(
      { bibleId: ID, versionId: ID2, digest: "0".repeat(64) },
      bible,
    ),
    /摘要/,
  );
  await assert.rejects(
    resolveStyleBibleRef({ bibleId: ID3, versionId: ID2, digest }, bible),
    /不匹配/,
  );
  assert.throws(
    () =>
      validateVideoProject({
        ...sample(),
        styleBibleRef: { bibleId: ID, versionId: ID2, digest, palette: {} },
      }),
    /不得内嵌/,
  );
});

test("3D 主体与强调轴使用同一风格版本的对象色和强调色", () => {
  const version = structuredClone(bible.versions[0]!);
  version.palette.accent = "#3268d9";
  const result = styleSceneSpec(
    {
      background: "#ffffff",
      params: {
        shape: "sphere",
        color: "#4f9dff",
        accent: "#e8b04b",
        zoom: 1,
      },
    },
    version,
  );
  assert.equal(result.background, "#101820");
  assert.deepEqual(result.params, {
    shape: "sphere",
    color: "#c98548",
    accent: "#3268d9",
    zoom: 1,
  });
});

test("流程节点文字在深浅 Style Bible 下与节点底色保持对比，旧源不被改写", () => {
  const source = {
    componentId: "flow-diagram",
    background: "#ffffff",
    params: {
      boxColor: "#eeeeee",
      textColor: "#111111",
      nodeTextColor: "#102033",
    },
  };
  const before = structuredClone(source);
  const dark = structuredClone(bible.versions[0]!);
  dark.palette.secondary = "#102033";
  dark.palette.foreground = "#102033";
  const darkResult = styleSceneSpec(source, dark).params as Record<
    string,
    string
  >;
  assert.equal(darkResult.nodeTextColor, "#ffffff");
  assert.equal(darkResult.boxColor, "#102033");
  const light = structuredClone(bible.versions[0]!);
  light.palette.secondary = "#f0f5ff";
  light.palette.foreground = "#102033";
  const lightResult = styleSceneSpec(source, light).params as Record<
    string,
    string
  >;
  assert.equal(lightResult.nodeTextColor, "#102033");
  const legacy = styleSceneSpec(
    { ...source, params: { boxColor: "#eeeeee", textColor: "#111111" } },
    dark,
  ).params as Record<string, string>;
  assert.equal(legacy.nodeTextColor, "#ffffff");
  assert.deepEqual(source, before);
});
