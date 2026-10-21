// three 场景源的深度校验：只做注册表查询 + 组件参数校验 + 返回规范化 spec。
// 结构规则（specVersion/durationMs/seed/background/params 形状与 256 KiB 上限）
// 的唯一实现点是 packages/video-document 的 validateVideoProject（Ruling 1），此处不重复。
import { threeRegistry } from "./registry.mjs";

export function validateThreeSpec(value, registry = threeRegistry) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("3D 场景 spec 必须是对象");
  }
  if (typeof value.componentId !== "string" || value.componentId.length === 0) {
    throw new Error("3D 场景 spec 缺少 componentId（须为非空字符串）");
  }
  if (value.componentVersion === undefined || value.componentVersion === null) {
    throw new Error(
      `3D 场景 spec 缺少 componentVersion（组件 ${value.componentId} 需要版本号）`,
    );
  }

  const component = registry.get(value.componentId, value.componentVersion);
  const params = component.validateParams(value.params ?? {});

  // 其余字段原样透传：结构合法性已由 validateVideoProject 负责。
  return { ...value, params };
}
