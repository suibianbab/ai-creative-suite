// W4 交互样片的运行时入口：一主体（演示立方体）、一交互（点击拆解/合拢），
// 外加拖拽转动（状态变化之一为拆解）。零网络依赖；由 esbuild 打成单 IIFE
// 内联进自包含 HTML。
import * as THREE from "three";

export function createApp(container, options = {}) {
  const state = { exploded: false, spins: 0 };
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);
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
  const main = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.4, 1.4),
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
  scene.add(group);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onMove = (event) => {
    if (!dragging) return;
    group.rotation.y += (event.clientX - lastX) * 0.01;
    group.rotation.x += (event.clientY - lastY) * 0.01;
    lastX = event.clientX;
    lastY = event.clientY;
    state.spins += Math.abs(event.clientX - lastX) * 0.01;
    container.dataset.rotated = "true";
  };
  const onUp = () => {
    dragging = false;
  };
  const toggle = () => {
    state.exploded = !state.exploded;
    const spread = state.exploded ? 1.5 : 0;
    main.position.set(spread, spread, spread);
    core.position.set(-spread, -spread, -spread);
    shellOut.position.set(spread * 0.8, spread * 0.8, spread * 0.8);
    container.dataset.exploded = String(state.exploded);
  };
  container.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  container.addEventListener("dblclick", toggle);

  let raf = 0;
  let frames = 0;
  const loop = () => {
    if (!dragging) group.rotation.y += 0.004;
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
      window.removeEventListener("pointerup", onUp);
      container.removeEventListener("dblclick", toggle);
      renderer.domElement.remove();
    },
    framesRendered: () => frames,
  };
}
