import assert from "node:assert/strict";
import { test } from "node:test";
import type { ThreeSceneSpec } from "@acs/video-document";
import {
  buildInteractiveHtml,
  inlineScriptJson,
  interactiveOptions,
} from "./interactive-export";

function spec(params: Record<string, unknown> = {}): ThreeSceneSpec {
  return {
    specVersion: 1,
    componentId: "orbit3d",
    componentVersion: 2,
    durationMs: 3000,
    seed: 1,
    background: "#101820",
    params,
  };
}

test("only registered orbit3d versions and bounded params reach interactive HTML", () => {
  assert.equal(
    interactiveOptions(spec({ shape: "sphere", zoom: 1.8 })).zoom,
    1.8,
  );
  assert.equal(interactiveOptions(spec()).shape, "box");
  assert.throws(
    () => interactiveOptions({ ...spec(), componentId: "other" }),
    /不支持 3D 组件/,
  );
  assert.throws(
    () =>
      interactiveOptions(
        spec({ shape: "</script><script>window.__x=1</script>" }),
      ),
    /形状不受支持/,
  );
  assert.throws(() => interactiveOptions(spec({ color: "red" })), /颜色无效/);
  assert.throws(() => interactiveOptions(spec({ zoom: 3 })), /zoom/);
  assert.throws(() => interactiveOptions(spec({ zoom: null })), /zoom/);
  assert.throws(
    () => interactiveOptions(spec({ unknown: 1 })),
    /不支持 unknown/,
  );
});

test("title and script JSON cannot terminate their HTML contexts", () => {
  const html = buildInteractiveHtml(
    "var W4App={createApp:()=>({state:{exploded:false}})};",
    "</title><script>window.__x=1</script>",
    interactiveOptions(spec()),
  );
  assert.ok(html.includes("&lt;/title&gt;&lt;script&gt;"));
  assert.ok(!html.includes("</title><script>window.__x"));
  assert.equal(
    inlineScriptJson({ shape: "</script><script>" }),
    '{"shape":"\\u003c/script\\u003e\\u003cscript\\u003e"}',
  );
});
