// W4 交互样片的运行时入口：一主体（演示立方体）、一交互（双击/双触/回车
// 拆解），外加拖拽转动。零网络依赖；由 esbuild 打成单 IIFE 内联进自包含
// HTML。C3 修复与增强：单指 pointerId 追踪（第二指不劫持）、touchCancel
// 结束拖转并恢复自动旋转、spins 在更新基准前累计（修复恒 0）、双击/双触
// 统一走 pointerdown 检测（不依赖 dblclick 合成）、键盘（方向键转动、
// 回车/空格拆解）与 aria-live 状态播报。
import * as THREE from "three";

export function createApp(container, options = {}) {
  const state = {
    exploded: false,
    spins: 0,
    get dragging() {
      return dragging;
    },
    get rotationY() {
      return group.rotation.y;
    },
  };
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
  // 屏幕阅读器状态播报（视觉隐藏；页面样式含 .w4-status 剪裁规则）。
  const status = document.createElement("span");
  status.className = "w4-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  container.appendChild(status);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.background ?? "#101820");
  const camera = new THREE.PerspectiveCamera(
    40,
    container.clientWidth / container.clientHeight,
    0.1,
    50,
  );
  camera.position.set(0, 1.6, 5.2);
  camera.lookAt(0, 0, 0);

  const group = new THREE.Group();
  // T3：主体几何跟随项目 spec 的 shape 参数（与 orbit3d createGeometry 同
  // 形状集），而非写死演示立方体。尺寸缩放使各形状视觉权重接近 W4 基线。
  const shapeGeometries = {
    box: () => new THREE.BoxGeometry(1.4, 1.4, 1.4),
    sphere: () => new THREE.SphereGeometry(0.95, 32, 16),
    torus: () => new THREE.TorusGeometry(0.75, 0.3, 16, 64),
    icosahedron: () => new THREE.IcosahedronGeometry(1.05, 0),
  };
  const shapeFactory = shapeGeometries[options.shape] ?? shapeGeometries.box;
  const main = new THREE.Mesh(
    shapeFactory(),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(options.color ?? "#4f9dff"),
      roughness: 0.45,
      metalness: 0.1,
    }),
  );
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(options.accent ?? "#e8b04b"),
      roughness: 0.3,
    }),
  );
  const shellOut = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.8, 1.8, 1.8)),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(options.accent ?? "#e8b04b"),
    }),
  );
  group.add(main, core, shellOut);
  // T3：初始倾角与自转速率跟随 spec 参数（缺省沿用 W4 演示值）。
  if (typeof options.tilt === "number") group.rotation.x = options.tilt;
  const autoSpin =
    typeof options.spinPerFrame === "number"
      ? options.spinPerFrame / 60 // spec 每帧@24fps → 60fps 页面近似
      : 0.004;
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);

  let dragging = false;
  let activePointerId = null;
  let lastX = 0;
  let lastY = 0;
  let lastTapAt = -Infinity;
  let lastTapX = 0;
  let lastTapY = 0;
  // 双击候选只对「未发生有效位移的轻点」有效（Codex 复核 Important#5）：
  // 拖转或被取消的指针会话不是 tap，结束时要作废候选，否则拖动后 350ms
  // 内的单击会与拖动起点配对而误触发拆解。
  let sessionMoved = false;
  let sessionStartX = 0;
  let sessionStartY = 0;
  const TAP_SLOP = 6;
  const DOUBLE_TAP_MS = 350;
  const DOUBLE_TAP_RADIUS = 40;

  const toggle = () => {
    state.exploded = !state.exploded;
    const spread = state.exploded ? 1.5 : 0;
    main.position.set(spread, spread, spread);
    core.position.set(-spread, -spread, -spread);
    shellOut.position.set(spread * 0.8, spread * 0.8, spread * 0.8);
    container.dataset.exploded = String(state.exploded);
    status.textContent = state.exploded ? "已拆解" : "已合拢";
    container.dispatchEvent(
      new CustomEvent("w4:state", {
        detail: { exploded: state.exploded },
      }),
    );
  };

  const onDown = (event) => {
    // 单指追踪：已有活动指针时，后来的指针（第二指）不劫持拖转。
    if (activePointerId !== null) return;
    activePointerId = event.pointerId;
    dragging = true;
    sessionMoved = false;
    sessionStartX = event.clientX;
    sessionStartY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    // 双击/双触统一检测：鼠标连击与触摸双触都表现为两次 pointerdown。
    // 一对完成即复位到 -Infinity（0 不行：页面加载后 350ms 内的首击会与
    // 「纪元 0」配对，连击三下会翻转三次——旧 e2e 截图快时实测触发）。
    const now = performance.now();
    const paired =
      now - lastTapAt <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - lastTapX, event.clientY - lastTapY) <=
        DOUBLE_TAP_RADIUS;
    if (paired) toggle();
    lastTapAt = paired ? -Infinity : now;
    lastTapX = event.clientX;
    lastTapY = event.clientY;
  };
  const onMove = (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    // 累计位移判拖动（每步增量可能小于 slop，逐步判定会漏——真 RED 实测）。
    if (
      Math.hypot(event.clientX - sessionStartX, event.clientY - sessionStartY) >
      TAP_SLOP
    )
      sessionMoved = true;
    group.rotation.y += dx * 0.01;
    group.rotation.x += dy * 0.01;
    // 先取增量再更新基准（修复旧实现恒加 0 的顺序缺陷）。
    state.spins += Math.abs(dx) * 0.01;
    lastX = event.clientX;
    lastY = event.clientY;
    container.dataset.rotated = "true";
  };
  const endDrag = (event) => {
    if (event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    // 拖动过或被系统取消的会话不是有效 tap：作废双击候选，
    // 防止后续快速单击与拖动起点误配对而触发拆解。
    if (sessionMoved || event.type === "pointercancel") lastTapAt = -Infinity;
  };
  const onKey = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = 0.12;
    let handled = true;
    let rotated = false;
    if (event.key === "ArrowLeft") {
      group.rotation.y -= step;
      rotated = true;
    } else if (event.key === "ArrowRight") {
      group.rotation.y += step;
      rotated = true;
    } else if (event.key === "ArrowUp") {
      group.rotation.x -= step;
      rotated = true;
    } else if (event.key === "ArrowDown") {
      group.rotation.x += step;
      rotated = true;
    } else if (event.key === "Enter" || event.key === " ") toggle();
    else handled = false;
    if (handled) {
      event.preventDefault();
      if (rotated) {
        container.dataset.rotated = "true";
        status.textContent = "已转动";
      }
    }
  };
  container.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", endDrag);
  // 触摸被滚动手势/系统手势接管时恢复自动旋转，不让拖转卡死。
  window.addEventListener("pointercancel", endDrag);
  container.addEventListener("keydown", onKey);

  let raf = 0;
  let frames = 0;
  const loop = () => {
    if (!dragging) group.rotation.y += autoSpin;
    renderer.render(scene, camera);
    frames += 1;
    raf = requestAnimationFrame(loop);
  };
  loop();
  return {
    state,
    dispose: () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      container.removeEventListener("keydown", onKey);
      status.remove();
      renderer.domElement.remove();
    },
    framesRendered: () => frames,
  };
}
