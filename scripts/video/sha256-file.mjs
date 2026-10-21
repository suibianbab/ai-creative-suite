// 大文件流式 sha256（original 可达数百 MB，不整读内存）。
// P2.5-T4 G3 自 render-scene.mjs 抽出：出片与 3D 烘焙共用同一实现。
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(file) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
