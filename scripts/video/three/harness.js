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
  const component = await import(`/scene/${config.componentId}.mjs`);
  const params = component.validateParams(config.params ?? {});
  const rig = component.createRig({
    THREE,
    params,
    background: config.background,
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
    component.pose(rig, frameIndex);
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
