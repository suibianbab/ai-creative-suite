import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { POST } from "./route";

const fixture = resolve(
  import.meta.dirname,
  "../../../../../../qa/fixtures/photocraft-hat-teal.png",
);

test("local edit uses provider mask and returns PNG only when configured", async () => {
  const originalFetch = globalThis.fetch;
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    provider: process.env.IMAGE_LOCAL_EDIT_PROVIDER,
    key: process.env.OPENAI_API_KEY,
  };
  const png = await readFile(fixture);
  const input = () => {
    const form = new FormData();
    form.set(
      "image",
      new File([new Uint8Array(png)], "source.png", { type: "image/png" }),
    );
    form.set(
      "mask",
      new File([new Uint8Array(png)], "mask.png", { type: "image/png" }),
    );
    form.set("prompt", "remove the mark");
    return new Request("http://localhost:3000/api/image-local-edit", {
      method: "POST",
      body: form,
    });
  };
  try {
    mutableEnv.NODE_ENV = "development";
    delete process.env.IMAGE_LOCAL_EDIT_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    assert.equal((await POST(input())).status, 503);
    process.env.IMAGE_LOCAL_EDIT_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-only";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.equal((options?.body as FormData).get("model"), "gpt-image-1.5");
      assert.match(
        String((options?.body as FormData).get("prompt")),
        /remove the mark/,
      );
      assert.equal(
        options?.headers &&
          (options.headers as Record<string, string>).authorization,
        "Bearer test-only",
      );
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    };
    const response = await POST(input());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnvironment.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.provider === undefined)
      delete process.env.IMAGE_LOCAL_EDIT_PROVIDER;
    else process.env.IMAGE_LOCAL_EDIT_PROVIDER = originalEnvironment.provider;
    if (originalEnvironment.key === undefined)
      delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalEnvironment.key;
  }
});

test("local edit sends a bounded rectangle to Qwen and accepts only provider image output", async () => {
  const originalFetch = globalThis.fetch;
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    provider: process.env.IMAGE_LOCAL_EDIT_PROVIDER,
    key: process.env.DASHSCOPE_API_KEY,
    endpoint: process.env.DASHSCOPE_IMAGE_ENDPOINT,
  };
  const png = await readFile(fixture);
  const input = (
    rect = [1, 1, 30, 30],
    mode: "local" | "background" = "local",
  ) => {
    const form = new FormData();
    form.set(
      "image",
      new File([new Uint8Array(png)], "source.png", { type: "image/png" }),
    );
    form.set(
      "mask",
      new File([new Uint8Array(png)], "mask.png", { type: "image/png" }),
    );
    form.set("prompt", "make the brim red");
    form.set("rect", JSON.stringify(rect));
    form.set("mode", mode);
    return new Request("http://localhost:3000/api/image-local-edit", {
      method: "POST",
      body: form,
    });
  };
  try {
    mutableEnv.NODE_ENV = "development";
    process.env.IMAGE_LOCAL_EDIT_PROVIDER = "qwen";
    process.env.DASHSCOPE_API_KEY = "test-only";
    delete process.env.DASHSCOPE_IMAGE_ENDPOINT;
    assert.equal((await POST(input([-1, 1, 30, 30]))).status, 400);
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(
          url,
          "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        );
        assert.equal(
          (options?.headers as Record<string, string>).authorization,
          "Bearer test-only",
        );
        const body = JSON.parse(String(options?.body));
        assert.equal(body.model, "qwen-image-2.0-pro");
        assert.match(
          body.input.messages[0].content[1].text,
          /x=1, y=1, width=30, height=30/,
        );
        return Response.json({
          output: {
            choices: [
              {
                message: {
                  content: [
                    {
                      image:
                        "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png",
                    },
                  ],
                },
              },
            ],
          },
        });
      }
      assert.equal(
        String(url),
        "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png",
      );
      assert.equal(options?.redirect, "error");
      return new Response(new Uint8Array(png), {
        headers: { "content-type": "image/png" },
      });
    };
    const response = await POST(input());
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(calls, 2);
    calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      if (calls === 1) {
        const body = JSON.parse(String(options?.body));
        assert.match(
          body.input.messages[0].content[1].text,
          /ONLY an empty replacement background/,
        );
        assert.doesNotMatch(
          body.input.messages[0].content[1].text,
          /Preserve the rest of the image/,
        );
        return Response.json({
          output: {
            choices: [
              {
                message: {
                  content: [
                    {
                      image:
                        "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png",
                    },
                  ],
                },
              },
            ],
          },
        });
      }
      assert.equal(
        String(url),
        "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png",
      );
      return new Response(new Uint8Array(png));
    };
    assert.equal(
      (await POST(input([0, 0, 1254, 1254], "background"))).status,
      200,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({
      NODE_ENV: previous.nodeEnv,
      IMAGE_LOCAL_EDIT_PROVIDER: previous.provider,
      DASHSCOPE_API_KEY: previous.key,
      DASHSCOPE_IMAGE_ENDPOINT: previous.endpoint,
    })) {
      if (value === undefined) delete mutableEnv[name];
      else mutableEnv[name] = value;
    }
  }
});
