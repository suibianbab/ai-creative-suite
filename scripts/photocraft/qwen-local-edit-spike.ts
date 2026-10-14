import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { QwenLocalImageEditProvider } from "../../apps/web/src/app/image-studio/photocraft/local-image-provider";

async function main() {
  const task = process.argv[2] || "brim";
  const cases = {
    brim: {
      prompt:
        "Change the cap brim to vivid red while keeping its fabric texture and preserving the rest of the cap.",
      rect: [250, 720, 920, 350] as [number, number, number, number],
    },
    remove: {
      prompt:
        "Remove the white FORM 01 label patch from the cap crown. Reconstruct the original teal woven fabric and stitching naturally underneath it. Preserve all other details.",
      rect: [600, 470, 300, 190] as [number, number, number, number],
    },
    background: {
      prompt:
        "Replace only the gray studio background with a soft warm beige studio background. Keep the cap itself, its exact shape, fabric, label and colors unchanged.",
      rect: [0, 0, 1254, 1254] as [number, number, number, number],
    },
  };
  if (!(task in cases)) throw new Error("Unknown Qwen spike case");
  const selected = cases[task as keyof typeof cases];
  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) throw new Error("DASHSCOPE_API_KEY is required");
  const bytes = await readFile(
    resolve(__dirname, "../../qa/fixtures/photocraft-hat-teal.png"),
  );
  const image = new File([new Uint8Array(bytes)], "source.png", {
    type: "image/png",
  });
  const provider = new QwenLocalImageEditProvider(
    key,
    process.env.IMAGE_LOCAL_EDIT_MODEL || "qwen-image-2.0-pro",
    process.env.DASHSCOPE_IMAGE_ENDPOINT,
  );
  const result = await provider.edit(
    image,
    image,
    selected.prompt,
    selected.rect,
  );
  const output = resolve(
    __dirname,
    task === "brim"
      ? "../../artifacts/qwen-local-edit-spike-2026-10-13.png"
      : `../../artifacts/qwen-${task}-spike-2026-10-13.png`,
  );
  await writeFile(output, result);
  process.stdout.write(`Saved PNG (${result.length} bytes): ${output}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error}\n`);
  process.exitCode = 1;
});
