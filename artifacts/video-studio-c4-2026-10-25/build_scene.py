
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

# 参照轴：0.08x2.2x0.08 @ (2.6,-0.2,0)，无照明（Emission 近似 MeshBasic）。
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2.6, -0.2, 0))
axis = bpy.context.active_object
axis.name = "ReferenceAxis"
axis.scale = (0.08, 0.08, 2.2)
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
scene.cycles.samples = 48
scene.cycles.seed = 0
scene.cycles.device = "GPU"
scene.cycles.use_adaptive_sampling = False
scene.frame_start = 0
scene.frame_end = 71
scene.render.fps = 24
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.view_settings.view_transform = "Standard"
scene.render.film_transparent = False

bpy.ops.wm.save_as_mainfile(filepath="D:/codex/animate/.claude/worktrees/video-studio-closure/.tools/video-studio-c4-blender/scene.blend")
print("SCENE_SAVED")
