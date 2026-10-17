import type { SvgNode } from "./svg.js";

// 帧上下文由渲染器注入：组件是 (spec, ctx) → SvgNode 的纯函数。
// 禁墙钟/Date.now/未播种随机/网络（ADR 0003 §2.3）——ctx.random 是唯一随机来源。
export type FrameContext = {
  frame: number;
  fps: number;
  durationFrames: number;
  width: number;
  height: number;
  random: () => number;
};

export type SceneComponent = {
  componentId: string;
  version: number;
  validateParams(value: unknown): unknown;
  render(spec: SceneSpecLike, ctx: FrameContext): SvgNode;
};

// 避免循环依赖：registry 只需要 spec 的形状（spec.ts 反过来 import registry 校验）。
export type SceneSpecLike = {
  componentId: string;
  componentVersion: number;
  durationMs: number;
  seed: number;
  background: string;
  params: unknown;
};

export class UnknownComponentError extends Error {}

export type SceneRegistry = {
  get(componentId: string, version: number): SceneComponent;
  list(): SceneComponent[];
  version: number;
};

// 版本化注册表（ADR 0003 §2.1–2.2）：新视觉能力 = 新组件 + 版本号，规划器只能对着它出 spec。
export function createRegistry(
  components: SceneComponent[],
  registryVersion: number,
): SceneRegistry {
  const map = new Map<string, SceneComponent>();
  for (const component of components) {
    const key = `${component.componentId}@${component.version}`;
    if (map.has(key)) throw new Error(`组件 ${key} 重复注册`);
    map.set(key, component);
  }
  return {
    version: registryVersion,
    get(componentId: string, version: number): SceneComponent {
      const found = map.get(`${componentId}@${version}`);
      if (!found) {
        throw new UnknownComponentError(
          `组件 ${componentId}@${version} 未注册（可用：${[...map.keys()].join(", ")}）`,
        );
      }
      return found;
    },
    list: () => [...map.values()],
  };
}
