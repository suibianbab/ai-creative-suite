// :4104 parts-candidates 响应契约 + grounding fixture 完整性校验 + 可注入
// fetch 的取数函数（codex 第四轮 B 项）。与 grounding-eval.mjs（live runner）
// 和 grounding-contract.test.mjs（本地模拟服务注入）共用同一实现，避免
// 「runner 的校验」与「被测的校验」漂移成两套口径。
//
// 契约（scripts/photocraft/parts-candidates.py）：
//   正常响应：{phrase?, width, height, candidates:[{index, score, clip_score,
//     bounds:[x,y,w,h], outline:[[x,y]…], mask_png_b64, area_ratio}], took_ms}
//   无候选：  {candidates: [], reason:"no-regions", width, height, took_ms}
//     —— no-regions 与正常响应同带有限正数宽高；candidates=[] 且 reason=
//     no-regions 才是「合法无候选」，缺字段/非法值一律算坏响应。
//   score 是同批候选上的 softmax 置信度，值域 [0,1]；bounds/outline 是
//   「返回图（最长边 ≤1024）」像素坐标，必须落在返回图尺寸内。
//   sam_score（重排序证据链，可选有限数 ∈[0,1]）：SAM 自身 IoU 分，评测端
//   可离线复算 clip/ensemble 两种序；rank 字段（可选 "clip"|"ensemble"）
//   声明本响应实际使用的排序。
//   mask_png_b64（C 项，正常候选必填）：base64 的 8bit 灰度 PNG（255=选中），
//   IHDR 宽高必须等于响应 width/height（与 bounds/outline 同坐标系）；
//   非空性由桥端 select.loadSelection 探针保证（与 provider 蒙版同分工），
//   这里只钉结构——否则 IMG-053 会对「mask 被剥掉」的回归放行。

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

// 逐项校验单个候选；返回错误消息或 null。
function candidateError(candidate, width, height, position) {
  const at = `候选 #${position}`;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return `${at} 不是对象`;
  const { score, bounds, outline } = candidate;
  if (!isFiniteNumber(score) || score < 0 || score > 1)
    return `${at} score 非法（须为 [0,1] 内有限数）：${score}`;
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(isFiniteNumber)
  )
    return `${at} bounds 须为 4 个有限数`;
  const [x, y, w, h] = bounds;
  if (w <= 0 || h <= 0) return `${at} bounds 宽高须为正`;
  if (x < 0 || y < 0 || x + w > width || y + h > height)
    return `${at} bounds 超出返回图尺寸 ${width}×${height}：[${x},${y},${w},${h}]`;
  if (!Array.isArray(outline)) return `${at} outline 缺失或非法（须为数组）`;
  for (const point of outline) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every(isFiniteNumber)
    )
      return `${at} outline 点须为 [x,y] 有限数对`;
    if (point[0] < 0 || point[0] >= width || point[1] < 0 || point[1] >= height)
      return `${at} outline 点超出返回图尺寸：[${point[0]},${point[1]}]`;
  }
  if (
    candidate.index !== undefined &&
    (!Number.isInteger(candidate.index) || candidate.index < 1)
  )
    return `${at} index 非法`;
  if (
    candidate.clip_score !== undefined &&
    !isFiniteNumber(candidate.clip_score)
  )
    return `${at} clip_score 非法`;
  if (
    candidate.sam_score !== undefined &&
    (!isFiniteNumber(candidate.sam_score) ||
      candidate.sam_score < 0 ||
      candidate.sam_score > 1)
  )
    return `${at} sam_score 非法（须为 [0,1] 内有限数）`;
  if (candidate.area_ratio !== undefined) {
    if (
      !isFiniteNumber(candidate.area_ratio) ||
      candidate.area_ratio <= 0 ||
      candidate.area_ratio > 1
    )
      return `${at} area_ratio 须为 (0,1]`;
  }
  // mask_png_b64（C 项）：严格 base64 → 8bit 灰度 PNG → IHDR 尺寸==返回图。
  // Buffer.from 对非法字符是宽容的（静默丢弃），所以先过严格正则。
  const maskB64 = candidate.mask_png_b64;
  if (typeof maskB64 !== "string" || maskB64.length === 0)
    return `${at} mask_png_b64 缺失（正常候选必带真实像素蒙版）`;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(maskB64) || maskB64.length % 4 !== 0)
    return `${at} mask_png_b64 不是合法 base64`;
  const maskHeader = parseGrayscalePngHeader(Buffer.from(maskB64, "base64"));
  if (!maskHeader) return `${at} mask_png_b64 不是 8bit 灰度 PNG`;
  if (maskHeader.width !== width || maskHeader.height !== height)
    return `${at} mask 尺寸 ${maskHeader.width}×${maskHeader.height} 与返回图 ${width}×${height} 不一致`;
  return null;
}

/**
 * 校验 /v1/candidates 响应。
 * @returns {{ok:true, response:object} | {ok:false, error:string}}
 */
export function validateCandidatesResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return { ok: false, error: "响应不是 JSON 对象" };
  const { width, height, candidates, reason } = payload;
  if (!isFiniteNumber(width) || width <= 0)
    return { ok: false, error: `width 非法：${width}` };
  if (!isFiniteNumber(height) || height <= 0)
    return { ok: false, error: `height 非法：${height}` };
  if (!Array.isArray(candidates))
    return { ok: false, error: "candidates 缺失或不是数组" };
  if (
    payload.took_ms !== undefined &&
    (!isFiniteNumber(payload.took_ms) || payload.took_ms < 0)
  )
    return { ok: false, error: "took_ms 非法" };
  // rank（重排序声明，可选）：clip | ensemble。缺失视为 clip（历史响应）。
  if (
    payload.rank !== undefined &&
    payload.rank !== "clip" &&
    payload.rank !== "ensemble"
  )
    return { ok: false, error: `rank 非法（clip|ensemble）：${payload.rank}` };
  if (reason !== undefined && reason !== null) {
    if (reason !== "no-regions")
      return { ok: false, error: `未知 reason：${reason}` };
    if (candidates.length !== 0)
      return { ok: false, error: "reason=no-regions 但候选非空" };
    return { ok: true, response: payload };
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const error = candidateError(candidates[i], width, height, i + 1);
    if (error) return { ok: false, error };
  }
  return { ok: true, response: payload };
}

/**
 * 校验 grounding fixture（annotations.json + provenance.json）完整性：
 * 标注框在 [0,1]、图/目标计数、domains 映射、来源记录逐图覆盖。
 * @returns {{ok:boolean, errors:string[], images:number, targets:number, boxes:number}}
 */
export function validateAnnotations(annotations, provenance) {
  const errors = [];
  let images = 0;
  let targets = 0;
  let boxes = 0;
  const bad = (message) => {
    errors.push(message);
    return { ok: false, errors, images, targets, boxes };
  };
  if (!annotations || typeof annotations !== "object")
    return bad("annotations.json 不是对象");
  if (annotations.schemaVersion !== 1)
    errors.push(`schemaVersion=${annotations.schemaVersion} 非 1`);
  const threshold = annotations.hitIoUThreshold;
  if (!isFiniteNumber(threshold) || threshold <= 0 || threshold >= 1)
    errors.push(`hitIoUThreshold 非法：${threshold}`);
  if (!annotations.domains || typeof annotations.domains !== "object")
    return bad("domains 映射缺失");
  if (!provenance || typeof provenance !== "object")
    return bad("provenance.json 不是对象");
  if (!Array.isArray(annotations.images) || annotations.images.length === 0)
    return bad("images 为空（评测集不可为空）");
  const domainNames = new Set(Object.keys(annotations.domains));
  for (const entry of annotations.images) {
    images += 1;
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.image !== "string" ||
      !entry.image
    )
      return bad(`第 ${images} 个图条目非法`);
    if (!domainNames.has(entry.domain))
      errors.push(
        `${entry.image}: domain "${entry.domain}" 不在 domains 映射中`,
      );
    if (
      !Number.isInteger(entry.width) ||
      entry.width <= 0 ||
      !Number.isInteger(entry.height) ||
      entry.height <= 0
    )
      errors.push(
        `${entry.image}: 标注宽高非法（${entry.width}×${entry.height}）`,
      );
    if (!Array.isArray(entry.targets) || entry.targets.length === 0)
      errors.push(`${entry.image}: targets 为空`);
    else
      for (const target of entry.targets) {
        targets += 1;
        if (
          !target ||
          typeof target.phrase !== "string" ||
          !target.phrase.trim()
        )
          errors.push(`${entry.image}: 第 ${targets} 个目标 phrase 非法`);
        if (!Array.isArray(target.boxes) || target.boxes.length === 0)
          errors.push(`${entry.image}｜${target?.phrase}: boxes 为空`);
        else
          for (const box of target.boxes) {
            boxes += 1;
            if (
              !Array.isArray(box) ||
              box.length !== 4 ||
              !box.every(isFiniteNumber)
            ) {
              errors.push(
                `${entry.image}｜${target?.phrase}: 框须为 4 个有限数`,
              );
              continue;
            }
            const [x, y, w, h] = box;
            if (
              x < 0 ||
              y < 0 ||
              w <= 0 ||
              h <= 0 ||
              x + w > 1 + 1e-9 ||
              y + h > 1 + 1e-9
            )
              errors.push(
                `${entry.image}｜${target.phrase}: 框 [${box}] 超出归一化范围 [0,1]`,
              );
          }
      }
    if (provenance && !Object.hasOwn(provenance, entry.image))
      errors.push(`${entry.image}: provenance 缺来源记录`);
  }
  return { ok: errors.length === 0, errors, images, targets, boxes };
}

/**
 * 从 PNG 字节解析「8bit 灰度」头（IHDR 位深 8、颜色类型 0；不解码整图）。
 * 契约要求候选蒙版是严格 0/255 单通道 PNG；RGB/调色板 PNG 判非法。
 * @param {Buffer} bytes
 * @returns {{width:number, height:number} | null}
 */
export function parseGrayscalePngHeader(bytes) {
  if (
    bytes.length < 26 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  )
    return null;
  // IHDR：偏移 12-15 数据类型、16-19 宽、20-23 高、24 位深、25 颜色类型。
  if (bytes[24] !== 8 || bytes[25] !== 0) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * 从图片字节解析像素宽高（PNG IHDR / JPEG SOFn；不解码整图）。
 * @param {Buffer} bytes
 * @returns {{width:number, height:number} | null}
 */
export function parseImageSize(bytes) {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      offset += 2 + length;
    }
  }
  return null;
}

/**
 * 取候选（429 按 Retry-After 退避重试；非 2xx / 坏 JSON / 契约不合规都返回
 * error，由调用方记执行错误并非零退出；fetchImpl 可注入用于模拟服务测试）。
 */
export async function fetchCandidates({
  base,
  imageBytes,
  contentType,
  phrase,
  promptBox = null, // D 项：可选 [x1,y1,x2,y2] 归一化画框（box 提示模式）
  excludePoints = null, // 剔除点：可选 1-4 个 [x,y] 归一化点（仅 box 模式）
  rank = null, // 重排序：可选 "clip"|"ensemble"（缺省 = 服务默认 clip）
  fetchImpl = fetch,
}) {
  const headers = {
    "Content-Type": contentType,
    "X-Acs-Phrase-B64": Buffer.from(phrase, "utf8").toString("base64"),
  };
  if (promptBox) headers["X-Acs-Prompt-Box"] = JSON.stringify(promptBox);
  if (excludePoints && excludePoints.length)
    headers["X-Acs-Exclude-Points"] = JSON.stringify(excludePoints);
  if (rank) headers["X-Acs-Rank"] = rank;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${base}/v1/candidates`, {
        method: "POST",
        headers,
        body: imageBytes,
      });
    } catch (cause) {
      return { error: `请求失败：${cause?.message ?? cause}` };
    }
    if (response.status === 429) {
      await new Promise((sleep) =>
        setTimeout(
          sleep,
          Number(response.headers.get("retry-after") ?? "2") * 1000,
        ),
      );
      continue;
    }
    if (!response.ok)
      return {
        error: `${response.status} ${(await response.text()).slice(0, 200)}`,
      };
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { error: "响应不是合法 JSON" };
    }
    const verdict = validateCandidatesResponse(payload);
    if (!verdict.ok)
      return {
        error: `响应不合规（${verdict.error}）：${JSON.stringify(payload).slice(0, 200)}`,
      };
    return { response: payload };
  }
  return { error: "服务持续繁忙（429）" };
}
