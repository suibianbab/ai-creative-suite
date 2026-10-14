import sharp from "sharp";

export type GenerationQuality = {
  changedInside: number;
  changedOutside: number;
  rectangularSeam: boolean;
};

/** Guardrail for gross composition failures; human review still decides finished-image quality. */
export async function inspectGeneratedComposite(
  original: Buffer,
  composed: Buffer,
  rect: [number, number, number, number],
): Promise<GenerationQuality> {
  const left = await sharp(original)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const right = await sharp(composed)
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = left.info;
  if (
    width !== right.info.width ||
    height !== right.info.height ||
    channels !== 3 ||
    right.info.channels !== 3
  )
    throw new Error("Generated composite dimensions changed");
  const [x, y, w, h] = rect;
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height)
    throw new Error("Generated selection is outside canvas");
  const distance = (a: Buffer, b: Buffer, px: number, py: number) => {
    const i = (py * width + px) * 3;
    return (
      (Math.abs(a[i]! - b[i]!) +
        Math.abs(a[i + 1]! - b[i + 1]!) +
        Math.abs(a[i + 2]! - b[i + 2]!)) /
      3
    );
  };
  let changedInside = 0;
  let changedOutside = 0;
  for (let py = 0; py < height; py += 3)
    for (let px = 0; px < width; px += 3) {
      const inside =
        px >= x + 3 && px < x + w - 3 && py >= y + 3 && py < y + h - 3;
      const outside =
        px < x - 8 || px >= x + w + 8 || py < y - 8 || py >= y + h + 8;
      if (distance(left.data, right.data, px, py) > 6) {
        if (inside) changedInside++;
        else if (outside) changedOutside++;
      }
    }
  const edge = (points: [number, number, number, number][]) => {
    let tested = 0,
      hits = 0;
    for (const [ix, iy, ox, oy] of points) {
      if (
        ix < 0 ||
        iy < 0 ||
        ox < 0 ||
        oy < 0 ||
        ix >= width ||
        ox >= width ||
        iy >= height ||
        oy >= height
      )
        continue;
      tested++;
      const interiorChange = distance(left.data, right.data, ix, iy);
      const exteriorChange = distance(left.data, right.data, ox, oy);
      const contrast = (buffer: Buffer) => {
        const a = (iy * width + ix) * 3,
          b = (oy * width + ox) * 3;
        return (
          (Math.abs(buffer[a]! - buffer[b]!) +
            Math.abs(buffer[a + 1]! - buffer[b + 1]!) +
            Math.abs(buffer[a + 2]! - buffer[b + 2]!)) /
          3
        );
      };
      if (
        interiorChange > 18 &&
        exteriorChange < 8 &&
        contrast(right.data) - contrast(left.data) > 14
      )
        hits++;
    }
    return tested >= 24 && hits / tested > 0.45;
  };
  const top: [number, number, number, number][] = [];
  const bottom: [number, number, number, number][] = [];
  const sideA: [number, number, number, number][] = [];
  const sideB: [number, number, number, number][] = [];
  for (let px = x + 4; px < x + w - 4; px += 2) {
    top.push([px, y + 2, px, y - 2]);
    bottom.push([px, y + h - 3, px, y + h + 1]);
  }
  for (let py = y + 4; py < y + h - 4; py += 2) {
    sideA.push([x + 2, py, x - 2, py]);
    sideB.push([x + w - 3, py, x + w + 1, py]);
  }
  return {
    changedInside,
    changedOutside,
    rectangularSeam: edge(top) || edge(bottom) || edge(sideA) || edge(sideB),
  };
}
