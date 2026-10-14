import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { QwenImageGenerationProvider } from "./image-generation-provider.js";

test("Qwen accepts a signed trusted OSS image URL and rejects foreign hosts", async () => {
  const png = await sharp({
    create: { width: 40, height: 40, channels: 4, background: "red" },
  })
    .png()
    .toBuffer();
  const originalFetch = globalThis.fetch;
  const signedUrl =
    "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png?Expires=123&Signature=secret";
  let downloaded = false;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("https://dashscope.aliyuncs.com/"))
        return Response.json({
          output: {
            choices: [{ message: { content: [{ image: signedUrl }] } }],
          },
        });
      assert.equal(url, signedUrl);
      downloaded = true;
      return new Response(png, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    };
    const provider = new QwenImageGenerationProvider("test-key");
    assert.deepEqual(
      await provider.generate({
        image: png,
        prompt: "edit",
        rect: [0, 0, 4, 4],
        width: 4,
        height: 4,
      }),
      png,
    );
    assert.equal(downloaded, true);
    globalThis.fetch = async () =>
      Response.json({
        output: {
          choices: [
            {
              message: {
                content: [{ image: "https://evil.example/image.png" }],
              },
            },
          ],
        },
      });
    await assert.rejects(
      provider.generate({
        image: png,
        prompt: "edit",
        rect: [0, 0, 4, 4],
        width: 4,
        height: 4,
      }),
      /Invalid Qwen output host/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
