// 3D 组件封闭注册表：键为 `${componentId}@${version}`。
// 唯一 import 是同目录的组件模块（相对路径，浏览器静态服务可直接解析）；
// 本模块不 import three —— three 对象一律由 createRig 的调用方传入。
import * as orbit3d from "./components/orbit3d.mjs";

export class UnknownThreeComponentError extends Error {
  constructor(componentId, componentVersion) {
    super(`未知 3D 组件：${componentId}@${componentVersion}`);
    this.name = "UnknownThreeComponentError";
    this.componentId = componentId;
    this.componentVersion = componentVersion;
  }
}

function keyOf(componentId, componentVersion) {
  return `${componentId}@${componentVersion}`;
}

export function createThreeRegistry(initialComponents = []) {
  const components = new Map();

  const registry = {
    version: 1,

    register(component) {
      const key = keyOf(component.componentId, component.version);
      if (components.has(key)) {
        throw new Error(`3D 组件 ${key} 已注册，不能重复注册`);
      }
      components.set(key, component);
    },

    get(componentId, componentVersion) {
      const component = components.get(keyOf(componentId, componentVersion));
      if (component === undefined) {
        throw new UnknownThreeComponentError(componentId, componentVersion);
      }
      return component;
    },

    list() {
      return [...components.keys()];
    },
  };

  for (const component of initialComponents) {
    registry.register(component);
  }

  return registry;
}

// 单例：封闭注册表，只含 orbit3d@1。
export const threeRegistry = createThreeRegistry([orbit3d]);
