// orbit3d@1：封闭组件注册表的唯一组件（3D 镜头源）。
// 本模块顶层零 import：所有 three 对象都由调用方传入的 THREE 构造，
// 因而既能在 Node 测试里加载，也能由静态服务器直接提供给浏览器页面。

export const componentId = "orbit3d";
export const version = 1;

const SHAPES = Object.freeze(["box", "sphere", "torus", "icosahedron"]);

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// 参数表与默认值（与计划 §Task 2 参数表逐项一致）。
const DEFAULTS = Object.freeze({
  shape: "box",
  color: "#4f9dff",
  accent: "#e8b04b",
  spinPerFrame: 0.02,
  tilt: 0.35,
  zoom: 1,
});

// 数值参数范围（含端点）。
const RANGES = Object.freeze({
  spinPerFrame: [0, 0.5],
  tilt: [0, 1.5],
  zoom: [0.5, 2],
});

function readColor(params, key) {
  const value = Object.hasOwn(params, key) ? params[key] : DEFAULTS[key];
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(`orbit3d 参数 ${key} 须为 #RRGGBB 格式的颜色`);
  }
  return value;
}

function readNumber(params, key) {
  const [min, max] = RANGES[key];
  const value = Object.hasOwn(params, key) ? params[key] : DEFAULTS[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`orbit3d 参数 ${key} 须为 ${min} 到 ${max} 之间的数值`);
  }
  return value;
}

// 校验并规范化参数：补齐默认值、拒绝未知键与越界值。
export function validateParams(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("orbit3d 参数必须是对象");
  }

  const unknownKeys = Object.keys(value).filter(
    (key) => !Object.hasOwn(DEFAULTS, key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`orbit3d 参数包含未知参数：${unknownKeys.join("、")}`);
  }

  const shape = Object.hasOwn(value, "shape") ? value.shape : DEFAULTS.shape;
  if (!SHAPES.includes(shape)) {
    throw new Error(`orbit3d 参数 shape 必须是 ${SHAPES.join(" | ")} 之一`);
  }

  return {
    shape,
    color: readColor(value, "color"),
    accent: readColor(value, "accent"),
    spinPerFrame: readNumber(value, "spinPerFrame"),
    tilt: readNumber(value, "tilt"),
    zoom: readNumber(value, "zoom"),
  };
}

function createGeometry(THREE, shape) {
  switch (shape) {
    case "sphere":
      return new THREE.SphereGeometry(1.25, 32, 16);
    case "torus":
      return new THREE.TorusGeometry(0.9, 0.35, 16, 64);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(1.3, 0);
    default:
      return new THREE.BoxGeometry(2, 2, 2);
  }
}

// 构建场景图：固定光照、固定参照轴、可配主体。
// 相机取景与 P3-B 快验一致（正交相机、16:9 视野、zoom 缩放）。
export function createRig({ THREE, params, background }) {
  if (!THREE || typeof THREE.Scene !== "function") {
    throw new Error("orbit3d.createRig 需要传入 three 命名空间（THREE）");
  }
  const normalized = validateParams(params);
  const { zoom, tilt } = normalized;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(2.5, 4, 3);
  scene.add(key);

  const camera = new THREE.OrthographicCamera(
    -4 * zoom,
    4 * zoom,
    2.25 * zoom,
    -2.25 * zoom,
    0.1,
    100,
  );
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  // 参照轴：保证画面有内容而非纯色，位置与尺寸不随时间变化。
  const axis = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 2.2, 0.08),
    new THREE.MeshBasicMaterial({ color: normalized.accent }),
  );
  axis.position.set(2.6, -0.2, 0);
  scene.add(axis);

  const mesh = new THREE.Mesh(
    createGeometry(THREE, normalized.shape),
    new THREE.MeshStandardMaterial({
      color: normalized.color,
      roughness: 0.4,
      metalness: 0,
      flatShading: false,
    }),
  );
  mesh.rotation.x = tilt;
  mesh.rotation.y = 0;
  scene.add(mesh);

  return { scene, camera, mesh, params: normalized };
}

// 逐帧姿态：旋转角只由帧号与参数决定，不读时钟、不用 fps/时长。
export function pose(rig, frameIndex) {
  rig.mesh.rotation.y = frameIndex * rig.params.spinPerFrame;
}
