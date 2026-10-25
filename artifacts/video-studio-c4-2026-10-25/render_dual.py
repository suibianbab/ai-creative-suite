
import bpy, os, sys, time
argv = sys.argv[sys.argv.index("--") + 1:]
aspect, out_dir, mode = argv[0], argv[1], argv[2]
scene = bpy.context.scene
scene.render.resolution_x = 720 if aspect == "portrait" else 1280
# 竖版 720x405：与横版同一 8x4.5 视锥（90px/单位，方形像素）；
# 后续由 ffmpeg 拉伸到 720x1280——精确复刻 Three 路线的竖版映射行为。
scene.render.resolution_y = 405 if aspect == "portrait" else 720
def render_frame(frame, prefix):
    target = out_dir.rstrip("/\\") + "/%s_%04d.png" % (prefix, frame)
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
