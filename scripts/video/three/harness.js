// 3D 烘焙页：读 page.addInitScript 注入的 window.__THREE_SCENE_CONFIG__，
// 构建确定性渲染器，暴露 window.bakeInfo / window.bakeFrame。
// 确定性底线：姿态只由帧号驱动（不读 performance.now()/Date）；
// antialias:false、preserveDrawingBuffer:true、setPixelRatio(1)、画布尺寸=配置宽高。
import * as THREE from "three";

const COMPONENT_ID = /^[a-z][a-zA-Z0-9]{0,63}$/;

try {
  const config = window.__THREE_SCENE_CONFIG__;
  if (config === null || typeof config !== "object") {
    throw new Error("缺少烘焙配置 window.__THREE_SCENE_CONFIG__");
  }
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(config[key]) || config[key] <= 0) {
      throw new Error(`烘焙配置 ${key} 须为正整数`);
    }
  }
  if (
    typeof config.componentId !== "string" ||
    !COMPONENT_ID.test(config.componentId)
  ) {
    throw new Error("烘焙配置 componentId 非法");
  }
  if (
    typeof config.background !== "string" ||
    !/^#[0-9a-fA-F]{6}$/.test(config.background)
  ) {
    throw new Error("烘焙配置 background 须为 #RRGGBB");
  }

  const canvas = document.createElement("canvas");
  canvas.width = config.width;
  canvas.height = config.height;
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
    depth: true,
    stencil: false,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(config.width, config.height, false);
  renderer.setClearColor(config.background, 1);

  // 封闭注册表的组件文件（components/<componentId>.mjs）由静态服务只读提供；
  // 页面侧再做一次参数校验，防止绕过 Node 侧烘焙入口。
  const module = await import(`/scene/${config.componentId}.mjs`);
  // 版本选择（T1）：模块导出 orbit3dV1/orbit3dV2 对象；无版本化的旧形状
  // （顶层 validateParams/createRig）仍按原路径工作。
  const component =
    config.componentVersion === 2 && module.orbit3dV2
      ? module.orbit3dV2
      : config.componentVersion === 1 && module.orbit3dV1
        ? module.orbit3dV1
        : module;
  const params = component.validateParams(config.params ?? {});
  // 画幅传入装配层（T1）：@2 按宽高算方形像素视锥；@1 忽略之（历史渲染不变）。
  const rig = component.createRig({
    THREE,
    params,
    background: config.background,
    width: config.width,
    height: config.height,
  });

  const gl = renderer.getContext();
  let glRenderer = "(unavailable)";
  try {
    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
    glRenderer = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
  } catch (error) {
    glRenderer = `(error: ${error instanceof Error ? error.message : error})`;
  }
  const attributes = gl.getContextAttributes();

  window.bakeFrame = (frameIndex) => {
    if (!Number.isInteger(frameIndex) || frameIndex < 0) {
      throw new Error("帧号须为非负整数");
    }
    (module.pose ? module.pose : component.pose)(rig, frameIndex);
    renderer.render(rig.scene, rig.camera);
    return canvas.toDataURL("image/png");
  };

  window.bakeInfo = {
    ready: true,
    threeVersion: THREE.REVISION,
    width: config.width,
    height: config.height,
    dpr: renderer.getPixelRatio(),
    antialias: attributes ? attributes.antialias : false,
    preserveDrawingBuffer: attributes ? attributes.preserveDrawingBuffer : true,
    glRenderer,
    glVersion: gl.getParameter(gl.VERSION),
    colorSpace: renderer.outputColorSpace,
  };
} catch (error) {
  window.bakeError = error instanceof Error ? error.message : String(error);
  console.error(window.bakeError);
}
