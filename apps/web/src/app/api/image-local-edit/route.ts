import {
  OpenAiLocalImageEditProvider,
  QwenLocalImageEditProvider,
} from "../../image-studio/photocraft/local-image-provider";

let activeGeneration = false;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function POST(request: Request) {
  // Production use requires workspace authorization, queued jobs and Credit Ledger.
  if (
    process.env.NODE_ENV !== "development" ||
    !(
      (process.env.IMAGE_LOCAL_EDIT_PROVIDER === "openai" &&
        process.env.OPENAI_API_KEY) ||
      (process.env.IMAGE_LOCAL_EDIT_PROVIDER === "qwen" &&
        process.env.DASHSCOPE_API_KEY)
    )
  )
    return Response.json(
      { error: "局部 AI 生成尚未配置图片 Provider。" },
      { status: 503 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "跨站请求已拒绝。" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 22_000_000)
    return Response.json({ error: "图片过大。" }, { status: 413 });
  if (activeGeneration)
    return Response.json(
      { error: "已有局部生成任务正在运行。" },
      { status: 429 },
    );

  let image: File;
  let mask: File;
  let prompt: string;
  let rect: [number, number, number, number] | undefined;
  let mode: "local" | "background";
  try {
    const form = await request.formData();
    image = form.get("image") as File;
    mask = form.get("mask") as File;
    prompt = String(form.get("prompt") ?? "").trim();
    const modeValue = String(form.get("mode") ?? "local");
    if (modeValue !== "local" && modeValue !== "background")
      throw new Error("invalid edit mode");
    mode = modeValue;
    const rectValue = form.get("rect");
    if (rectValue !== null) {
      const parsed = JSON.parse(String(rectValue));
      if (
        !Array.isArray(parsed) ||
        parsed.length !== 4 ||
        parsed.some((value) => !Number.isInteger(value))
      )
        throw new Error("invalid edit rect");
      rect = parsed as [number, number, number, number];
    }
    if (
      !(image instanceof File) ||
      !(mask instanceof File) ||
      image.type !== "image/png" ||
      mask.type !== "image/png" ||
      image.size < 100 ||
      image.size > 16_000_000 ||
      mask.size < 100 ||
      mask.size > 4_000_000 ||
      prompt.length < 3 ||
      prompt.length > 400
    )
      throw new Error("invalid input");
    const [sourceBytes, maskBytes] = await Promise.all([
      image.arrayBuffer(),
      mask.arrayBuffer(),
    ]);
    if (
      !Buffer.from(sourceBytes).subarray(0, 8).equals(pngSignature) ||
      !Buffer.from(maskBytes).subarray(0, 8).equals(pngSignature) ||
      Buffer.from(sourceBytes).readUInt32BE(16) !==
        Buffer.from(maskBytes).readUInt32BE(16) ||
      Buffer.from(sourceBytes).readUInt32BE(20) !==
        Buffer.from(maskBytes).readUInt32BE(20) ||
      (process.env.IMAGE_LOCAL_EDIT_PROVIDER === "qwen" &&
        (!rect ||
          rect[0] < 0 ||
          rect[1] < 0 ||
          rect[2] < 1 ||
          rect[3] < 1 ||
          rect[0] + rect[2] > Buffer.from(sourceBytes).readUInt32BE(16) ||
          rect[1] + rect[3] > Buffer.from(sourceBytes).readUInt32BE(20)))
    )
      throw new Error("invalid PNG dimensions");
  } catch {
    return Response.json(
      { error: "局部图片、蒙版或要求无效。" },
      { status: 400 },
    );
  }

  activeGeneration = true;
  try {
    const provider =
      process.env.IMAGE_LOCAL_EDIT_PROVIDER === "qwen"
        ? new QwenLocalImageEditProvider(
            process.env.DASHSCOPE_API_KEY!,
            process.env.IMAGE_LOCAL_EDIT_MODEL || "qwen-image-2.0-pro",
            process.env.DASHSCOPE_IMAGE_ENDPOINT,
          )
        : new OpenAiLocalImageEditProvider(
            process.env.OPENAI_API_KEY!,
            process.env.IMAGE_LOCAL_EDIT_MODEL || "gpt-image-1.5",
          );
    const bytes = await provider.edit(image, mask, prompt, rect, mode);
    if (
      bytes.length < 100 ||
      bytes.length > 25_000_000 ||
      !bytes.subarray(0, 8).equals(pngSignature)
    )
      throw new Error("invalid PNG output");
    return new Response(new Uint8Array(bytes), {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "局部生成失败，请稍后重试。",
      },
      { status: 502 },
    );
  } finally {
    activeGeneration = false;
  }
}
