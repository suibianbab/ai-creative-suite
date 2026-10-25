#!/usr/bin/env node
// C4：Blender 路线双画幅渲染与 Three 路线同机位对照（W3 协议执行轮）。
// 执行器：主检出 .tools 的便携版 Blender 5.2.2 LTS（不改系统安装）。
// 场景：非品牌程序化演示立方体，逐参数移植 W3 Three Golden Spike 的
// orbit3d@1 rig（同正交机位 ±4×±2.25、同灯位、同旋转动画 0..71 帧）。
// 确定性：Cycles 固定采样 48、固定 seed、固定设备（OPTIX）；输出 PNG 序列
// → 系统 ffmpeg 编码。横版 1280×720；竖版按 Three 路线真实行为（同一
// 16:9 视锥拉伸映射到 9:16）先渲 720×405 再像素级拉伸到 720×1280。
// GPU/CPU：nvidia-smi 全卡采样（口径同 2026-10-09 spike：整卡观测，
// 非 Blender 独占归因）；另做单帧 CPU 设备计时对照。
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const BLENDER = "D:/codex/animate/.tools/blender-5.2.2-windows-x64/blender.exe";
const WORK = path.join(ROOT, ".tools/video-studio-c4-blender");
const OUT = path.join(ROOT, "artifacts/video-studio-c4-2026-10-25");
const THREE_W3 = path.join(
  ROOT,
  "artifacts/video-studio-w3-2026-10-24/three-route",
);
const FRAMES = 72; // Three spike 的立方体镜头段（0..71 帧，3s @24fps）
const SAMPLES = 48;
const SEED = 0;

if (!existsSync(BLENDER)) {
  console.error(`Blender 执行器不存在：${BLENDER}`);
  process.exit(1);
}
mkdirSync(path.join(WORK, "landscape"), { recursive: true });
mkdirSync(path.join(WORK, "portrait"), { recursive: true });
mkdirSync(OUT, { recursive: true });

const run = (args, opts = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(BLENDER, args, { windowsHide: true, ...opts });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.once("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`blender exit ${code}`)),
    );
    child.once("error", reject);
  });

// —— GPU 全卡采样（与 2026-10-09 host-run-report 同口径）——
function sampleGpu() {
  try {
    const out = execFileSync(
      "nvidia-smi",
      [
        "--query-gpu=memory.used,utilization.gpu",
        "--format=csv,noheader,nounits",
      ],
      { encoding: "utf8" },
    );
    const [memoryUsed, utilization] = out
      .trim()
      .split("\n")[0]
      .split(",")
      .map((value) => Number(value.trim()));
    return { memoryUsed, utilization };
  } catch {
    return null;
  }
}
class GpuMonitor {
  constructor() {
    this.baseline = sampleGpu();
    this.peakMemory = 0;
    this.peakUtilization = 0;
    this.timer = null;
  }
  start() {
    this.timer = setInterval(() => {
      const sample = sampleGpu();
      if (sample) {
        this.peakMemory = Math.max(this.peakMemory, sample.memoryUsed);
        this.peakUtilization = Math.max(
          this.peakUtilization,
          sample.utilization,
        );
      }
    }, 500);
  }
  stop() {
    clearInterval(this.timer);
  }
}

// —— build_scene.py：程序化建模（移植 orbit3d@1 rig，坐标即 Three 世界系）——
const buildScene = `
import bpy, math
from mathutils import Vector, Color

def srgb(hexstr):
    # Blender 节点颜色按线性存储；Three 的 #RRGGBB 是 sRGB 显示值。
    c = Color([int(hexstr[i:i+2], 16) / 255.0 for i in (1, 3, 5)])
    return c.from_srgb_to_scene_linear()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# 主体：2x2x2 演示立方体（#4f9dff，roughness 0.4 / metal 0），tilt 0.35rad。
bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 0))
cube = bpy.context.active_object
cube.name = "DemoCube"
mat = bpy.data.materials.new("CubeMat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (*srgb("#4f9dff"), 1.0)
bsdf.inputs["Roughness"].default_value = 0.4
bsdf.inputs["Metallic"].default_value = 0.0
cube.data.materials.append(mat)
cube.rotation_euler = (0.35, 0.0, 0.0)
# 自转：frame*0.02（确定性驱动，非时钟），与 Three pose() 同式。
cube.driver_add("rotation_euler", 1)
cube.animation_data.drivers[0].driver.expression = "frame*0.02"

# 参照轴：0.08x2.2x0.08 @ (2.6,-0.2,0)，长边沿 Y（与 Three 的
# BoxGeometry(0.08, 2.2, 0.08) 同轴——Codex 复核 Important#2 修复：
# 旧值长边在 Z 正对相机，只剩一个点）。
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.6, -0.2, 0))
axis = bpy.context.active_object
axis.name = "ReferenceAxis"
axis.scale = (0.08, 2.2, 0.08)
amat = bpy.data.materials.new("AxisMat")
amat.use_nodes = True
nt = amat.node_tree
bsdf = nt.nodes.get("Principled BSDF")
if bsdf: nt.nodes.remove(bsdf)
emit = nt.nodes.new("ShaderNodeEmission")
emit.inputs["Color"].default_value = (*srgb("#e8b04b"), 1.0)
emit.inputs["Strength"].default_value = 1.0
nt.links.new(emit.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
axis.data.materials.append(amat)

# 相机：正交，sensor HORIZONTAL，ortho_scale=8（视锥宽 8 单位 = Three ±4）。
# 机位 (0,0,10) 朝原点、+Y 上：Blender 单位相机在恒等旋转下即沿 -Z 看、
# +Y 为上——世界坐标轴在本场景中直接扮演 Three 的世界轴（相机定屏幕系）。
cam_data = bpy.data.cameras.new("OrthoCam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 8.0
cam_data.clip_start = 0.1
cam_data.clip_end = 100.0
cam_data.sensor_fit = "HORIZONTAL"
cam = bpy.data.objects.new("OrthoCam", cam_data)
cam.location = (0.0, 0.0, 10.0)
cam.rotation_euler = (0.0, 0.0, 0.0)
scene.collection.objects.link(cam)
scene.camera = cam

# 主灯：Three DirectionalLight(白, 2.0) @ (2.5,4,3) → Sun 近似移植。
sun_data = bpy.data.lights.new("KeySun", "SUN")
sun_data.energy = 3.0
sun_data.angle = 0.0
sun = bpy.data.objects.new("KeySun", sun_data)
sun.location = (2.5, 4.0, 3.0)
direction = Vector((2.5, 4.0, 3.0))
sun.rotation_euler = (-direction).normalized().to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(sun)

# 世界：相机射线见纯背景 #101820（Three scene.background），其余射线走
# 均匀白环境强度 0.111（近似 AmbientLight 0.35 的朗伯注入；单位制不同的
# 近似移植，如实入档）。
world = bpy.data.worlds.new("ThreeLikeWorld")
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes["Background"]
mix = nt.nodes.new("ShaderNodeMix") if hasattr(bpy.types, "ShaderNodeMix") else None
# Light Path 方案（5.x ShaderNodeMix 已着色器化，直接用经典 MixRGB 不稳；
# 用两个 Background + LightPath+MixShader 最稳）：
mix_shader = nt.nodes.new("ShaderNodeMixShader")
light_path = nt.nodes.new("ShaderNodeLightPath")
bg_camera = nt.nodes.new("ShaderNodeBackground")
bg_camera.inputs["Color"].default_value = (*srgb("#101820"), 1.0)
bg_camera.inputs["Strength"].default_value = 1.0
bg_env = nt.nodes.new("ShaderNodeBackground")
bg_env.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
bg_env.inputs["Strength"].default_value = 0.111
out = nt.nodes["World Output"]
nt.links.new(light_path.outputs["Is Camera Ray"], mix_shader.inputs["Fac"])
# Fac=1（相机射线）选第二输入 → bg_camera；其余射线（漫反射环境光）走 bg_env。
nt.links.new(bg_env.outputs["Background"], mix_shader.inputs[1])
nt.links.new(bg_camera.outputs["Background"], mix_shader.inputs[2])
nt.links.new(mix_shader.outputs["Shader"], out.inputs["Surface"])
if bg: nt.nodes.remove(bg)
scene.world = world

# Cycles 确定性：固定采样与种子。设备：显式启用 OPTIX（工厂默认偏好不勾
# 任何 compute device，scene.cycles.device="GPU" 会静默回退 CPU——首轮
# 实测 40s/帧、GPU 占用 8% 即此坑，见报告）。
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
for dev in prefs.devices:
    dev.use = (dev.type == "OPTIX")
scene.render.engine = "CYCLES"
scene.cycles.samples = ${SAMPLES}
scene.cycles.seed = ${SEED}
scene.cycles.device = "GPU"
scene.cycles.use_adaptive_sampling = False
scene.frame_start = 0
scene.frame_end = ${FRAMES - 1}
scene.render.fps = 24
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = False

bpy.ops.wm.save_as_mainfile(filepath="${(WORK + "/scene.blend").replace(/\\/g, "/")}")
print("SCENE_SAVED")
`;

// —— render_dual.py：按画幅渲染对照关键帧（14/36/65）+ 中段 1s 运动序列
//（24..47 帧）。时间盒裁决：本机 Cycles 实测 20-50s/帧（设备归因见报告
// deviceInvestigation），72×2 全长动画外推 1-2 小时，超出本轮预算；对照
// 时刻的关键帧 + 运动段已覆盖评分表全部维度。——
const renderDual = `
import bpy, os, sys, time
argv = sys.argv[sys.argv.index("--") + 1:]
aspect, out_dir, mode = argv[0], argv[1], argv[2]
scene = bpy.context.scene
scene.render.resolution_x = 720 if aspect == "portrait" else 1280
# 竖版 720x405：与横版同一 8x4.5 视锥（90px/单位，方形像素）；
# 后续由 ffmpeg 拉伸到 720x1280——精确复刻 Three 路线的竖版映射行为。
scene.render.resolution_y = 405 if aspect == "portrait" else 720
def render_frame(frame, prefix):
    target = out_dir.rstrip("/\\\\") + "/%s_%04d.png" % (prefix, frame)
    if os.path.exists(target):
        print("SKIP", prefix, frame, flush=True)
        return
    scene.frame_set(frame)
    scene.render.filepath = target[:-4]
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print("FRAME_DONE", prefix, frame, round(time.time() - t0, 2), flush=True)
if mode in ("keys", "full"):
    for frame in (14, 36, 65):
        render_frame(frame, "key")
if mode in ("motion", "full"):
    for frame in range(24, 48):
        render_frame(frame, "motion")
print("RENDER_DONE", aspect, mode)
`;

writeFileSync(path.join(WORK, "build_scene.py"), buildScene);
writeFileSync(path.join(WORK, "render_dual.py"), renderDual);

// 冒烟模式：只建场景 + 渲一帧（验证 bpy API 与 rig，不跑全程）。
if (process.argv.includes("--smoke")) {
  await run(["--background", "--python", path.join(WORK, "build_scene.py")], {
    cwd: WORK,
  });
  const smoke = `
import bpy
scene = bpy.context.scene
scene.render.resolution_x = 320
scene.render.resolution_y = 180
scene.render.filepath = "${(WORK + "/smoke").replace(/\\/g, "/")}"
scene.frame_set(36)
bpy.ops.render.render(write_still=True)
print("SMOKE_OK")
`;
  writeFileSync(path.join(WORK, "smoke.py"), smoke);
  await run([
    "--background",
    path.join(WORK, "scene.blend"),
    "--python",
    path.join(WORK, "smoke.py"),
  ]);
  const smokePng = readdirSync(WORK).find(
    (name) => name.startsWith("smoke") && name.endsWith(".png"),
  );
  if (!smokePng) throw new Error("smoke frame missing");
  // 像素级回归断言（终审补）：背景逐像素等于 #101820（会抓住 sRGB→线性
  // 转换缺失类回归——该 bug 实测渲成 (71,87,99)）；主体蓝与参照轴金存在。
  const rgb = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    path.join(WORK, smokePng),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  const at = (x, y) => {
    const i = (y * 320 + x) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };
  const corner = at(2, 2);
  if (corner[0] !== 0x10 || corner[1] !== 0x18 || corner[2] !== 0x20)
    throw new Error(
      `冒烟帧背景应为 #101820，实测 rgb(${corner.join(",")})（疑似 sRGB/线性转换回归）`,
    );
  let blue = 0;
  let gold = 0;
  let goldMinY = 180;
  let goldMaxY = -1;
  for (let i = 0, p = 0; i + 2 < rgb.length; i += 3, p += 1) {
    const [r, g, b] = [rgb[i], rgb[i + 1], rgb[i + 2]];
    const x = p % 320;
    const y = Math.floor(p / 320);
    if (b > r + 20 && b > 80) blue += 1;
    if (r > 150 && g > 110 && b < 110) {
      gold += 1;
      if (y < goldMinY) goldMinY = y;
      if (y > goldMaxY) goldMaxY = y;
    }
    void x;
  }
  if (blue < 100) throw new Error(`冒烟帧主体蓝色像素过少：${blue}`);
  // 参照轴形状断言（Codex r2 Important#2）：Y 向长轴高 2.2 单位 / 视锥高
  // 4.5 → 320×180 帧上 ≈88px 竖向跨度。旧 Z 轴错误只留 ~2px 小点；阈值
  // 60px 在正确轴（88）与错误点（~2）之间留 40× 区分度。
  const goldSpan = goldMaxY - goldMinY + 1;
  if (gold < 50 || goldSpan < 60)
    throw new Error(
      `冒烟帧参照轴须为竖直长条（金 ${gold}px、竖向跨度 ${goldSpan}px ≥60）——疑似轴向回归`,
    );
  console.log(
    `SMOKE PASS → ${smokePng}（背景 #101820 精确、蓝 ${blue}px、金 ${gold}px 竖跨 ${goldSpan}px）`,
  );
  process.exit(0);
}

const report = {
  protocol: "W3 BLENDER-ROUTE.md（C4 执行轮）",
  blenderExecutable: BLENDER,
  blender: null,
  subject: "非品牌程序化演示立方体（orbit3d@1 rig 参数级移植）",
  license: {
    scene: "自有程序化（本脚本生成 .blend；无外部模型/纹理）",
    blender:
      "Blender 5.2.2 LTS（GPL 工具，产物 .blend/png/mp4 为数据，不感染 GPL）",
  },
  determinism: {
    engine: "CYCLES",
    samples: SAMPLES,
    seed: SEED,
    adaptiveSampling: false,
  },
  frames: FRAMES,
  mode: "keyframes(14/36/65) + motion-segment(24..47) per aspect",
  timeBoxRuling:
    "本机 Cycles 实测 20-50s/帧（设备归因见 deviceInvestigation），72×2 全长动画外推 1-2 小时，超出本轮预算；关键帧+运动段覆盖评分表全部维度，全长成本以外推入档",
  aspects: {},
  commands: [],
  gpuMonitorNote:
    "nvidia-smi 整卡观测（非 Blender 独占归因），口径同 2026-10-09 host-run-report",
  attempts: [
    {
      note: "首轮未显式勾选 OPTIX compute device（工厂默认偏好为空），scene.cycles.device=GPU 会静默回退 CPU：实测约 40-45s/帧、GPU 占用 8%（nvidia-smi）、blender 进程 CPU 时间快速累积。修正：build_scene.py 显式启用 OPTIX 设备后重跑。",
      outcome: "已中止首轮（无产物入库），CPU 回退速率作为环境实测记录",
    },
  ],
  cpuProbe: null,
  deviceInvestigation: {
    configured:
      "OPTIX（prefs.compute_device_type=OPTIX，RTX 4060 OPTIX 项 use=True，scene.cycles.device=GPU，probe 输出留痕）",
    nvidia: "RTX 4060 / driver 595.95 / CUDA 13.2",
    observed:
      "渲染期间 nvidia-smi 整卡均值 6.1%、峰值 11%（35 样本/70s）——GPU 未实际承载采样；同进程对照：OPTIX 配置 24.4-59s/帧 vs CPU 设备 47-85s/帧（约 2x），远低于 2026-10-09 同一 blender.exe 的 5.5s/帧@1280x720x48spp 真实 OPTIX 速率",
    open: "工厂默认偏好不勾 compute device 时 GPU 设置被静默忽略（已修）；显式勾选后 GPU 利用率仍低——本会话未能定位（驱动 595.95 与当年环境的差异为首要嫌疑），如实留待环境复查",
  },
};

const version = execFileSync(BLENDER, ["--version"], { encoding: "utf8" });
report.blender = version.split("\n")[0].trim();

// 1) 建模（保存 .blend，源文件入证据）
const tBuild = Date.now();
await run(["--background", "--python", path.join(WORK, "build_scene.py")], {
  cwd: WORK,
});
report.buildSceneMs = Date.now() - tBuild;

// 2) 双画幅渲染（协议命令形态）。分相执行（--phase keys|motion，缺省 full）：
//    keys 先落对照关键帧证据（含并排对照图），motion 再补运动段——单相都可
//    独立跑完并写报告，避免长渲染被整体时间盒吞掉。
const PHASE = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : "full";
const PHASES = PHASE === "full" ? ["keys", "motion"] : [PHASE];
const renderPhase = async (mode) => {
  for (const aspect of ["landscape", "portrait"]) {
    const outDir = path.join(WORK, aspect);
    const monitor = new GpuMonitor();
    const started = Date.now();
    monitor.start();
    try {
      const command = `blender --background scene.blend --python render_dual.py -- ${aspect} ${aspect} ${mode}`;
      report.commands.push(command);
      await run(
        [
          "--background",
          path.join(WORK, "scene.blend"),
          "--python",
          path.join(WORK, "render_dual.py"),
          "--",
          aspect,
          outDir,
          mode,
        ],
        { cwd: WORK },
      );
    } finally {
      monitor.stop();
    }
    const elapsed = Date.now() - started;
    const keys = readdirSync(outDir).filter((name) =>
      /^key_.*\.png$/.test(name),
    );
    const motion = readdirSync(outDir).filter((name) =>
      /^motion_.*\.png$/.test(name),
    );
    if (mode !== "motion" && keys.length !== 3)
      throw new Error(`${aspect} 关键帧数不符：${keys.length}`);
    if (mode !== "keys" && motion.length !== 24)
      throw new Error(`${aspect} 运动段帧数不符：${motion.length}`);
    const framesRendered = mode === "keys" ? keys.length : motion.length;
    report.aspects[aspect] = {
      ...(report.aspects[aspect] ?? {}),
      [`${mode}RenderMs`]: elapsed,
      [`${mode}MsPerFrame`]: Math.round(elapsed / framesRendered),
      keyframes: keys.length,
      motionFrames: motion.length,
      gpuBaseline: monitor.baseline,
      gpuPeakMemoryUsedMib: monitor.peakMemory,
      gpuPeakUtilizationPercent: monitor.peakUtilization,
    };
  }
};
for (const phase of PHASES) {
  if (phase === "keys") await renderPhase("keys");
  if (phase === "motion") await renderPhase("motion");
  if (phase === "full") {
    await renderPhase("keys");
    await renderPhase("motion");
  }
}

// 3) CPU 单帧对照（设备切 CPU 渲第 36 帧），记录可用设备清单。
//    分相执行时只在 full/motion 相跑（keys 相保持最短关键路径）。
if (PHASE !== "keys") {
  const cpuProbe = `
import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
scene = bpy.context.scene
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.get_devices()
devices = [(d.name, d.type) for d in prefs.devices]
print("DEVICES", devices)
scene.cycles.device = "CPU"
scene.frame_set(36)
import time
t0 = time.time()
bpy.ops.render.render(write_still=False)
print("CPU_FRAME_SECONDS", round(time.time() - t0, 3))
`;
  writeFileSync(path.join(WORK, "cpu_probe.py"), cpuProbe);
  const cpuOut = await run(
    [
      "--background",
      path.join(WORK, "scene.blend"),
      "--python",
      path.join(WORK, "cpu_probe.py"),
      "--",
      "cpu",
    ],
    { cwd: WORK },
  );
  report.devices = JSON.parse(
    (cpuOut.match(/DEVICES (\[\[.*?\]\])/)?.[1] ?? "[]")
      .replace(/'/g, '"')
      .replace(/\(/g, "[")
      .replace(/\)/g, "]")
      .replace(/\]\s*,\s*\[/g, "],["),
  );
  report.cpuProbe = {
    frame: 36,
    seconds: Number(cpuOut.match(/CPU_FRAME_SECONDS ([\d.]+)/)?.[1] ?? 0),
    note: "单帧 CPU 设备计时（i5-14400F，48 samples，1280x720）",
  };
}

// 4) 运动段 PNG → H.264（竖版拉伸到 720x1280，复刻 Three 竖版映射）。
//    运动段存在才编码（keys 相跳过）。
const hasMotion = (aspect) =>
  readdirSync(path.join(WORK, aspect)).some((name) =>
    /^motion_.*\.png$/.test(name),
  );
for (const aspect of ["landscape", "portrait"]) {
  if (!hasMotion(aspect)) continue;
  const args = [
    "-y",
    "-v",
    "error",
    "-framerate",
    "24",
    "-start_number",
    "24",
    "-i",
    path.join(WORK, aspect, "motion_%04d.png"),
  ];
  if (aspect === "portrait") args.push("-vf", "scale=720:1280");
  args.push(
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    path.join(OUT, `motion-${aspect}.mp4`),
  );
  execFileSync("ffmpeg", args);
  report.aspects[aspect] = {
    ...(report.aspects[aspect] ?? {}),
    mp4: `motion-${aspect}.mp4`,
  };
}

// 5) 对照关键帧定名（14→early 0.6s / 36→mid 1.5s / 65→late 2.7s，与 W3
//    Three spike 的取帧时刻一致）+ 同机位并排对照图（关键帧存在即落证据）
const TAG_BY_FRAME = { 14: "early", 36: "mid", 65: "late" };
for (const aspect of ["landscape", "portrait"]) {
  for (const [frame, tag] of Object.entries(TAG_BY_FRAME)) {
    const source = path.join(
      WORK,
      aspect,
      `key_${String(frame).padStart(4, "0")}.png`,
    );
    if (existsSync(source))
      copyFileSync(source, path.join(OUT, `blender-${aspect}-${tag}.png`));
  }
  const blenderMid = path.join(OUT, `blender-${aspect}-mid.png`);
  if (existsSync(blenderMid))
    execFileSync("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-i",
      path.join(THREE_W3, `${aspect}-mid.png`),
      "-i",
      blenderMid,
      "-filter_complex",
      // 竖版 Blender 帧是 720×405（Three 同视锥原像）；对照图按 Three 终稿
      // 口径拉伸后再并排，保持「所见即终稿」的对照语义。
      aspect === "portrait"
        ? "[1:v]scale=720:1280[b];[0:v][b]hstack=inputs=2"
        : "hstack=inputs=2",
      path.join(OUT, `compare-${aspect}-mid.png`),
    ]);
}

// 6) 源文件与报告入证据（分相运行时与既有报告合并）
copyFileSync(path.join(WORK, "scene.blend"), path.join(OUT, "scene.blend"));
copyFileSync(
  path.join(WORK, "build_scene.py"),
  path.join(OUT, "build_scene.py"),
);
copyFileSync(
  path.join(WORK, "render_dual.py"),
  path.join(OUT, "render_dual.py"),
);
const reportPath = path.join(OUT, "c4-report.json");
const prior = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : {};
report.threeRouteBaseline = {
  summary:
    "artifacts/video-studio-w3-2026-10-24/three-route/spike-summary.json",
  bakeMs: 4805,
  renderMs: 45345,
  framesPerAspect: 96,
  note: "Three 基线为 96 帧（立方体段 72 + 尾随 1s spec 镜头）；Blender 轮按关键帧+运动段对照（见 mode/timeBoxRuling），取帧时刻 0.6/1.5/2.7s 与 Three spike 一致",
};
// 外推只用**真实渲染**的每帧成本（Codex r2 Important#4：keys 相被 SKIP
// 时 keysMsPerFrame 只含进程启动 ~0.2s/帧，曾把 47 分钟外推成 0）。
// 每画幅优先 motionMsPerFrame；缺失即标 unknown，绝不以 SKIP 计时冒充。
const motionPerAspect = ["landscape", "portrait"]
  .map((aspect) => report.aspects[aspect]?.motionMsPerFrame ?? undefined)
  .filter((value) => Number.isFinite(value) && value > 0);
if (motionPerAspect.length === 2) {
  const avgPerFrame =
    motionPerAspect.reduce((sum, value) => sum + value, 0) /
    motionPerAspect.length;
  report.fullAnimationExtrapolated = {
    frames: FRAMES * 2,
    estimatedMinutes: Math.round((avgPerFrame * FRAMES * 2) / 60000),
    basis: "每画幅实测 motionMsPerFrame 的均值（SKIP 计时不参与）",
  };
} else {
  report.fullAnimationExtrapolated = {
    frames: FRAMES * 2,
    estimatedMinutes: null,
    note: "本轮无完整的双画幅 motion 实测计时，外推未知（不以 SKIP 关键帧启动计时冒充）",
  };
}
report.rigPort = {
  camera:
    "正交 ±4×±2.25（ortho_scale 8, sensor HORIZONTAL）@ (0,0,10) 朝原点 +Y 上",
  cube: "2×2×2 #4f9dff roughness 0.4 metal 0，tilt X=0.35rad，自转 frame×0.02",
  axis: "0.08×2.2×0.08 #e8b04b（Emission 近似 MeshBasic）@ (2.6,-0.2,0)",
  lights:
    "Sun energy 3.0 @ 方位(2.5,4,3)（近似 DirectionalLight 2.0）；世界环境强度 0.111 近似 AmbientLight 0.35——单位制不同，是近似移植非逐像素复刻",
  portraitMapping:
    "Three 竖版实测为同一 16:9 视锥拉伸映射到 9:16（内容宽高比 0.45 vs 横版 1.43，实测吻合 3.16× 纵向拉伸）；Blender 轮先渲 720×405 再拉伸复刻同映射",
};
const merged = {
  ...prior,
  ...report,
  aspects: {
    ...(prior.aspects ?? {}),
    landscape: {
      ...(prior.aspects?.landscape ?? {}),
      ...(report.aspects.landscape ?? {}),
    },
    portrait: {
      ...(prior.aspects?.portrait ?? {}),
      ...(report.aspects.portrait ?? {}),
    },
  },
  cpuProbe: report.cpuProbe ?? prior.cpuProbe ?? null,
  devices: report.devices ?? prior.devices,
};
writeFileSync(reportPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`C4 blender dual (${PHASE}): DONE → ${OUT}`);
console.log(
  JSON.stringify(
    { aspects: merged.aspects, cpuProbe: merged.cpuProbe },
    null,
    2,
  ),
);
