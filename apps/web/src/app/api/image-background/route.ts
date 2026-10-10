const allowedSizes = new Set(["1024x1024", "1024x1536", "1536x1024"]);
let activeGeneration = false;

export async function POST(request: Request) {
  // The production SaaS path needs workspace auth, jobs and the Credit Ledger.
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.IMAGE_BACKGROUND_PROVIDER !== "openai" ||
    !process.env.OPENAI_API_KEY
  )
    return Response.json(
      { error: "AI 背景生成尚未配置；可先试用内置背景样片。" },
      { status: 503 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "跨站请求已拒绝。" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 1600)
    return Response.json({ error: "场景描述过长。" }, { status: 413 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1600) throw new Error("body too long");
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "请求格式无效。" }, { status: 400 });
  }
  const input = body as { prompt?: unknown; size?: unknown } | null;
  if (
    !input ||
    typeof input.prompt !== "string" ||
    !input.prompt.trim() ||
    input.prompt.length > 400 ||
    typeof input.size !== "string" ||
    !allowedSizes.has(input.size)
  )
    return Response.json({ error: "场景描述或尺寸无效。" }, { status: 400 });
  if (activeGeneration)
    return Response.json(
      { error: "已有背景生成任务正在运行。" },
      { status: 429 },
    );
  activeGeneration = true;
  try {
    const prompt = `Create a photorealistic empty commercial product photography BACKGROUND PLATE. Scene: ${input.prompt.trim()}. Leave the central product placement area empty. No product, no brand, no writing, no logo, no watermark. Match realistic lighting and perspective. This output will be placed behind an unchanged original product photograph.`;
    const upstream = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.IMAGE_BACKGROUND_MODEL || "gpt-image-2.5-flare",
          prompt,
          size: input.size,
          quality: "medium",
          output_format: "png",
          n: 1,
        }),
        signal: AbortSignal.timeout(180_000),
      },
    );
    if (!upstream.ok)
      return Response.json(
        { error: `图像 Provider 返回 HTTP ${upstream.status}。` },
        { status: 502 },
      );
    const output = await upstream.json();
    const encoded = output?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length > 35_000_000)
      throw new Error("invalid image payload");
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.length < 100 ||
      bytes.length > 25 * 1024 * 1024 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("invalid PNG");
    return new Response(bytes, {
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "背景生成失败，请稍后重试。" },
      { status: 502 },
    );
  } finally {
    activeGeneration = false;
  }
}
