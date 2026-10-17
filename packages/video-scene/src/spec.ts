import type { SceneRegistry, SceneSpecLike } from "./registry.js";

export type SceneSpec = SceneSpecLike & { specVersion: 1 };

export class SceneSpecValidationError extends Error {}

// ADR 0003 §2.4 资源限制：spec 大小上限。
export const MAX_SPEC_BYTES = 256 * 1024;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new SceneSpecValidationError(`Invalid scene_spec: ${message}`);
}

const encoder = new TextEncoder();

// 声明式 spec 的入站校验（ADR 0003 §2.1）：结构 + 注册表存在性 + 组件自己的 params 校验。
// TextEncoder 而非 Buffer：本包会被浏览器（工作台预览）与 Node（渲染）同时引用。
export function validateSceneSpec(
  value: unknown,
  registry: SceneRegistry,
): SceneSpec {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new SceneSpecValidationError("scene_spec 不是可序列化 JSON");
  }
  if (!json || encoder.encode(json).length > MAX_SPEC_BYTES) {
    fail(`超过 ${MAX_SPEC_BYTES} 字节上限`);
  }
  if (!isRecord(value)) fail("必须是对象");
  if (value.specVersion !== 1) fail("specVersion 必须为 1");
  if (typeof value.componentId !== "string" || value.componentId.length === 0) {
    fail("componentId 必须是非空字符串");
  }
  if (
    !Number.isInteger(value.componentVersion) ||
    (value.componentVersion as number) < 1
  ) {
    fail("componentVersion 必须是正整数");
  }
  if (!Number.isInteger(value.durationMs) || (value.durationMs as number) < 1) {
    fail("durationMs 必须是正整数");
  }
  if (!Number.isInteger(value.seed)) fail("seed 必须是整数");
  if (
    typeof value.background !== "string" ||
    !HEX_COLOR.test(value.background)
  ) {
    fail("background 必须是 #rrggbb");
  }
  let component;
  try {
    component = registry.get(
      value.componentId as string,
      value.componentVersion as number,
    );
  } catch {
    fail(
      `组件 ${value.componentId as string}@${value.componentVersion as number} 未注册`,
    );
  }
  component.validateParams(value.params); // 组件级 params 校验，错误原样抛出
  return value as SceneSpec;
}
