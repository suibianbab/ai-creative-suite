export interface LocalImageEditProvider {
  edit(
    image: File,
    mask: File,
    prompt: string,
    rect?: [number, number, number, number],
    mode?: "local" | "background",
  ): Promise<Buffer>;
}

const qwenEndpoint =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

export class QwenLocalImageEditProvider implements LocalImageEditProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly endpoint = qwenEndpoint,
  ) {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "dashscope.aliyuncs.com" ||
        url.hostname === "dashscope-intl.aliyuncs.com" ||
        /^[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(url.hostname)
      ) ||
      url.pathname !==
        "/api/v1/services/aigc/multimodal-generation/generation" ||
      url.search ||
      url.hash
    )
      throw new Error("千问图片 Provider 地址无效");
  }

  async edit(
    image: File,
    _mask: File,
    prompt: string,
    rect?: [number, number, number, number],
    mode: "local" | "background" = "local",
  ): Promise<Buffer> {
    if (!rect) throw new Error("千问局部编辑需要指定范围");
    const [x, y, width, height] = rect;
    const source = Buffer.from(await image.arrayBuffer());
    const imageWidth = source.readUInt32BE(16);
    const imageHeight = source.readUInt32BE(20);
    const instruction =
      mode === "background"
        ? `Create ONLY an empty replacement background for the supplied image: ${prompt}. Remove the foreground subject and its original shadow completely. No product, object, person, text, logo, silhouette, or cast shadow. Match the source perspective and lighting direction. Fill the whole frame with the background. Return a complete image, not a crop.`
        : `Edit the supplied image according to this instruction: ${prompt}. Apply the change only inside pixel rectangle x=${x}, y=${y}, width=${width}, height=${height} in the ${imageWidth}x${imageHeight} source image. Preserve the rest of the image, subject identity, composition, text, logos and lighting. Return a complete image, not a crop.`;
    const upstream = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          messages: [
            {
              role: "user",
              content: [
                { image: `data:image/png;base64,${source.toString("base64")}` },
                { text: instruction },
              ],
            },
          ],
        },
        parameters: { n: 1, watermark: false, prompt_extend: false },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!upstream.ok) {
      const failure = await upstream.json().catch(() => null);
      const code =
        typeof failure?.code === "string" &&
        /^[A-Za-z0-9_.-]{1,80}$/.test(failure.code)
          ? ` (${failure.code})`
          : "";
      const detail =
        typeof failure?.message === "string"
          ? ` ${failure.message.replace(/sk-[A-Za-z0-9-]+/g, "[redacted]").slice(0, 240)}`
          : "";
      throw new Error(
        `千问图片 Provider 返回 HTTP ${upstream.status}${code}。${detail}`,
      );
    }
    const data = await upstream.json();
    const resultUrl = data?.output?.choices?.[0]?.message?.content?.find(
      (item: unknown) =>
        typeof item === "object" && item !== null && "image" in item,
    )?.image;
    if (typeof resultUrl !== "string")
      throw new Error("千问图片 Provider 未返回图片");
    const url = new URL(resultUrl);
    if (
      url.protocol !== "https:" ||
      !/^dashscope-(?:result-[a-z0-9-]+|[a-f0-9]{4,16})\.oss-(?:accelerate|[a-z0-9-]+)\.aliyuncs\.com$/.test(
        url.hostname,
      )
    )
      throw new Error(`千问图片 Provider 返回的图片地址无效 (${url.hostname})`);
    const result = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (
      !result.ok ||
      Number(result.headers.get("content-length") ?? 0) > 25_000_000
    )
      throw new Error("千问图片 Provider 图片下载失败");
    const bytes = Buffer.from(await result.arrayBuffer());
    if (bytes.length > 25_000_000)
      throw new Error("千问图片 Provider 图片过大");
    return bytes;
  }
}

export class OpenAiLocalImageEditProvider implements LocalImageEditProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async edit(image: File, mask: File, prompt: string): Promise<Buffer> {
    const form = new FormData();
    form.set("image", image, "source.png");
    form.set("mask", mask, "mask.png");
    form.set("model", this.model);
    form.set(
      "prompt",
      `Edit only the transparent area of the supplied mask. ${prompt} Preserve the identity, composition, text, logo, lighting and all details outside that area.`,
    );
    form.set("output_format", "png");
    form.set("quality", "medium");
    const upstream = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!upstream.ok)
      throw new Error(`图片 Provider 返回 HTTP ${upstream.status}。`);
    const data = await upstream.json();
    const encoded = data?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length > 35_000_000)
      throw new Error("图片 Provider 返回结果无效");
    return Buffer.from(encoded, "base64");
  }
}
