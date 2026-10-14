/** Server-side image generation adapter. Credentials never enter job parameters or browser state. */
export interface ImageGenerationProvider {
  generate(input: {
    image: Buffer;
    prompt: string;
    rect: [number, number, number, number];
    width: number;
    height: number;
  }): Promise<Buffer>;
}

const endpoint =
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class QwenImageGenerationProvider implements ImageGenerationProvider {
  constructor(
    private readonly key: string,
    private readonly model = "qwen-image-2.0-pro",
    private readonly apiEndpoint = endpoint,
  ) {
    const url = new URL(apiEndpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !==
        "/api/v1/services/aigc/multimodal-generation/generation" ||
      !(
        url.hostname === "dashscope.aliyuncs.com" ||
        url.hostname === "dashscope-intl.aliyuncs.com" ||
        /^[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(url.hostname)
      )
    )
      throw new Error("Invalid Qwen image endpoint");
  }

  async generate({
    image,
    prompt,
    rect,
    width,
    height,
  }: Parameters<ImageGenerationProvider["generate"]>[0]): Promise<Buffer> {
    const [x, y, w, h] = rect;
    const instruction = `Edit the supplied image according to this instruction: ${prompt}. Apply the change only inside pixel rectangle x=${x}, y=${y}, width=${w}, height=${h} in the ${width}x${height} source image. Preserve subject identity, composition, text, logos, lighting and all details outside that region. Return a complete image, not a crop.`;
    const upstream = await fetch(this.apiEndpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.key}`,
        "content-type": "application/json",
      },
      redirect: "error",
      body: JSON.stringify({
        model: this.model,
        input: {
          messages: [
            {
              role: "user",
              content: [
                { image: `data:image/png;base64,${image.toString("base64")}` },
                { text: instruction },
              ],
            },
          ],
        },
        parameters: { n: 1, watermark: false, prompt_extend: false },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!upstream.ok)
      throw new Error(`Qwen image provider returned HTTP ${upstream.status}`);
    const data = await upstream.json();
    const resultUrl = data?.output?.choices?.[0]?.message?.content?.find(
      (item: unknown) =>
        typeof item === "object" && item !== null && "image" in item,
    )?.image;
    if (typeof resultUrl !== "string")
      throw new Error("Qwen image provider returned no image");
    const url = new URL(resultUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search.length > 4096 ||
      !/^dashscope-(?:result-[a-z0-9-]+|[a-f0-9]{4,16})\.oss-(?:accelerate|[a-z0-9-]+)\.aliyuncs\.com$/.test(
        url.hostname,
      )
    )
      throw new Error(`Invalid Qwen output host (${url.hostname})`);
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (
      !response.ok ||
      Number(response.headers.get("content-length") ?? 0) > 25_000_000
    )
      throw new Error("Qwen image download failed");
    if (!response.body) throw new Error("Qwen image download failed");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > 25_000_000) throw new Error("Qwen image output is too large");
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks, total);
    if (
      bytes.length < 100 ||
      bytes.length > 25_000_000 ||
      !bytes.subarray(0, 8).equals(PNG)
    )
      throw new Error("Invalid Qwen image output");
    return bytes;
  }
}
