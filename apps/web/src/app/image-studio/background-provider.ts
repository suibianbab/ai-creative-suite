export interface BackgroundPlateProvider {
  generate(
    prompt: string,
    canvas: { width: number; height: number },
  ): Promise<File>;
}

function imageSize(canvas: { width: number; height: number }) {
  const ratio = canvas.width / canvas.height;
  if (ratio < 0.9) return "1024x1536";
  if (ratio > 1.2) return "1536x1024";
  return "1024x1024";
}

export class AiBackgroundPlateProvider implements BackgroundPlateProvider {
  async generate(prompt: string, canvas: { width: number; height: number }) {
    const response = await fetch("/api/image-background", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, size: imageSize(canvas) }),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
          ? body.error
          : `背景生成失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (!response.headers.get("content-type")?.startsWith("image/png"))
      throw new Error("背景 Provider 未返回 PNG 图片。");
    const blob = await response.blob();
    if (!blob.size || blob.size > 25 * 1024 * 1024)
      throw new Error("背景 Provider 返回的图片大小无效。");
    return new File([blob], `ai-background-${Date.now()}.png`, {
      type: "image/png",
    });
  }
}

export async function loadSampleBackgroundPlate(): Promise<File> {
  const response = await fetch("/samples/warm-studio-empty.png");
  if (!response.ok) throw new Error("背景样片未找到。");
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("image/png"))
    throw new Error("背景样片格式无效。");
  return new File([blob], "warm-studio-empty.png", { type: "image/png" });
}
