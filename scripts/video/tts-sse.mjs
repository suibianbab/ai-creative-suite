// D2 Task2：DashScope CosyVoice TTS 的纯函数层（零网络，可单测）。
// 事件形态镜像 spike 实录 artifacts/d2-tts-spike/stream-response.sse.txt：
//   data:{"output":{"sentence":{"index":0,"words":[…]},"audio":{"data":"<base64>"},
//         "finish_reason":"null","type":"sentence-begin|sentence-synthesis|sentence-end"},
//         "usage":{"characters":34},"request_id":"…"}
// 纪律：音频必须逐 chunk 解码（output.audio.data）后 Buffer.concat——
// 把整条流的 base64 先拼再解会得到损坏字节（spike 实测 8KB ≠ 223KB）。

// 计费估算：仅供台账预算 sanity，真实计费以服务端 usage.characters 为准
// （中文按每字 2 计费字符）。已知价目：cosyvoice-v3-flash ¥1/万字符。
const PRICE_CNY_PER_10K = {
  "cosyvoice-v3-flash": 1,
};

export function estimateTtsCostCny(characters, model) {
  const price = PRICE_CNY_PER_10K[model];
  if (price === undefined) {
    throw new Error(`未知模型 ${model}，无计费价目；拒绝估算以防预算失守`);
  }
  return (characters / 10000) * price;
}

// 解析一条完整 SSE 文本流（CLI 已读尽 body）→ 结构化结果。
// 容错：非 JSON 的 data: 行与注释行（:keep-alive）跳过；同句后到的
// sentence 事件覆盖先到的（sentence-end 的 words 是完整版）。
export function parseTtsSse(text) {
  const sentences = new Map();
  const audioChunks = [];
  let requestId = null;
  let usage = null;
  let finishReason = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue; // 非 JSON 行（心跳/空行残留）不致命
    }
    if (event.request_id) requestId = event.request_id;
    if (event.usage) usage = event.usage;
    const output = event.output ?? {};
    if (
      typeof output.finish_reason === "string" &&
      output.finish_reason !== "null"
    ) {
      finishReason = output.finish_reason;
    }
    const type = output.type;
    if (type === "sentence-synthesis") {
      const data = output.audio?.data ?? "";
      if (data) audioChunks.push(Buffer.from(data, "base64"));
    } else if (type === "sentence-begin" || type === "sentence-end") {
      const sentence = output.sentence;
      if (sentence) {
        const prev = sentences.get(sentence.index);
        // 后到者覆盖：sentence-end 的 words 完整（begin 可能只是前缀）
        if (
          !prev ||
          (sentence.words?.length ?? 0) >= (prev.words?.length ?? 0)
        ) {
          sentences.set(sentence.index, {
            index: sentence.index,
            words: sentence.words ?? [],
          });
        }
      }
    }
  }

  return {
    requestId,
    usage,
    finishReason,
    audioChunks,
    sentences: [...sentences.values()].sort((a, b) => a.index - b.index),
  };
}

// 旁白任务构建：working version 的 narrationText → 合成作业。
// 空 narrationText 镜头跳过（单镜头 P0 落档时为空串，属正常）；
// >2000 字符（ContentVersion 上限）在计费前拒绝，点名镜头序号与长度。
export function buildNarrationJobs(project) {
  if (project.shots.length === 0) {
    throw new Error("项目没有任何镜头，无可合成旁白");
  }
  const jobs = [];
  project.shots.forEach((shot, shotIndex) => {
    const working = shot.contentVersions.find(
      (version) => version.versionId === shot.workingVersionId,
    );
    const text = working?.narrationText ?? "";
    if (text.length === 0) return;
    if (text.length > 2000) {
      throw new Error(
        `镜头 ${shotIndex + 1}（${shot.shotId}）旁白 ${text.length} 字符超 2000 上限，拒绝合成`,
      );
    }
    jobs.push({
      shotIndex,
      shotId: shot.shotId,
      versionId: working.versionId,
      text,
    });
  });
  return jobs;
}
