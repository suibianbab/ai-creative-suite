import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";

// Persistent PhotoCraft `serve` session (stdio JSON lines) replacing the
// per-request cold CLI. Two surfaces:
//
// - runCli(argv): interprets the exact argv shapes the bridge used to spawn
//   (`info <file> --compact`, `convert <in> <out>`,
//   `run <in> --cmd … --params … [--out <file>]`) and returns the same
//   string the cold CLI printed, so existing handlers stay unchanged. `info`
//   always cold-spawns (layer-id space parity with the cold runs that
//   execute layer-mutating plans — see cliInfo); per-request uuid folders
//   keep state from leaking between requests.
// - live documents: keep one document open across calls for slider handoff
//   (layer.setAdjustment + full-size save-as-PNG preview). Serve reuses and
//   shifts document indices as documents close, so live sessions resolve
//   their index by path through session.list on every call.
//
// The serve session only enables 137 of 851 registry commands: commands with
// ambient filesystem access (file.placeEmbedded, paint.stroke,
// layer.newFillLayer.*, image.imageSize, …) are refused. Operations whose
// steps include a serve-disabled command fall back to one cold CLI spawn —
// the provider-mask flows keep their exact previous behavior, while every
// selection/adjustment pipeline runs on the persistent session.
//
// All calls serialize through one queue (the serve session answers one
// request at a time), mirroring the previous maxActiveRequests=1 constraint.
// A hung or crashed session restarts on the next call.

const callTimeoutMs = 120_000;
const maxLiveDocuments = 3;

export function createServeTransport({ cli, root, log }) {
  const posixRoot = root.split("\\").join("/").replace(/\/+$/, "");
  let child = null;
  let killReason = null;
  let nextId = 1;
  const pending = new Map();
  const live = new Map(); // liveId -> { path }
  let queue = Promise.resolve();
  let enabledCommands = null;

  // The cold CLI keeps the full 851-command registry; the serve session
  // disables ambient-filesystem commands. Anything disabled here runs on a
  // cold spawn instead. Caveat discovered live: engine.commands reports menu
  // commands as enabled=true whenever ANY document is open (UI enablement),
  // while engine.execute keeps refusing them — so the allowlist is read once
  // against the pristine, document-less session right after spawn and stays
  // cached across child restarts (the policy is fixed per CLI version).
  let enabledCommandsReady = null;

  function primeEnabledCommands() {
    enabledCommandsReady = call("engine.commands", {})
      .then((commands) => {
        enabledCommands = new Set(
          commands.filter((entry) => entry.enabled).map((entry) => entry.id),
        );
      })
      .catch(() => {});
    return enabledCommandsReady;
  }

  async function serveAllows(commandId) {
    if (!enabledCommands) {
      await (enabledCommandsReady ?? primeEnabledCommands());
      if (!enabledCommands) return false; // registry unreadable → stay cold
    }
    return enabledCommands.has(commandId);
  }

  function relative(path) {
    const posix = path.split("\\").join("/");
    if (posix === posixRoot) return ".";
    return posix.startsWith(`${posixRoot}/`)
      ? posix.slice(posixRoot.length + 1)
      : posix;
  }

  // doc.render answers a preview downscaled to a ~1024px long edge, while
  // every preview the bridge has ever served (cold `convert`) was full-size.
  // Previews therefore export through doc.save-as-PNG — full-size, and (unlike
  // a project-format save-as) it does not re-point the document's identity
  // path, so live sessions keep resolving their document by path afterwards.
  async function savePngPreview(path) {
    await call("doc.save", { path: relative(path) });
    const buffer = await readFile(path);
    await unlink(path).catch(() => {});
    return buffer;
  }

  function ensureChild() {
    if (child) return child;
    killReason = null;
    child = spawn(
      cli,
      [
        "serve",
        "--automation-read-root",
        posixRoot,
        "--automation-write-root",
        posixRoot,
      ],
      { cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          const settle = pending.get(message.id);
          if (settle) {
            pending.delete(message.id);
            clearTimeout(settle.timer);
            settle.resolve(message);
          }
        } catch {
          // non-JSON noise on stdout is ignored
        }
      }
    });
    let stderrTail = "";
    child.stderr.on("data", (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2_000);
    });
    child.on("exit", (code) => {
      const failure = new Error(
        killReason ??
          `PhotoCraft serve 会话退出（码 ${code}）${stderrTail ? `：${stderrTail.slice(0, 300)}` : ""}`,
      );
      for (const settle of pending.values()) {
        clearTimeout(settle.timer);
        settle.reject(failure);
      }
      pending.clear();
      live.clear();
      child = null;
      log?.(`serve session gone (${code ?? "signal"}); next call restarts it`);
    });
    // Read the automation allowlist before any document opens (see the
    // engine.commands caveat at serveAllows).
    primeEnabledCommands();
    return child;
  }

  function call(method, params) {
    return new Promise((resolveCall, rejectCall) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        killReason = "PhotoCraft serve 调用超时，请重试";
        child?.kill();
        rejectCall(new Error(killReason));
      }, callTimeoutMs);
      pending.set(id, {
        resolve: (message) =>
          message.ok
            ? resolveCall(message.result)
            : rejectCall(
                new Error(
                  `${method}: ${
                    typeof message.error === "string"
                      ? message.error
                      : JSON.stringify(message.error)
                  }`,
                ),
              ),
        reject: rejectCall,
        timer,
      });
      ensureChild().stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  // Exact previous cold-spawn behavior, used only when a step needs a
  // serve-disabled command.
  function coldSpawn(args) {
    return new Promise((resolveRun, rejectRun) => {
      const process_ = spawn(cli, args, { cwd: root, windowsHide: true });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        process_.kill();
      }, callTimeoutMs);
      process_.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk.toString()).slice(-64_000);
      });
      process_.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-64_000);
      });
      process_.on("error", rejectRun);
      process_.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) rejectRun(new Error("PhotoCraft 任务超时，请重试"));
        else if (code === 0) resolveRun(stdout);
        else
          rejectRun(
            new Error(stderr.slice(0, 500) || `PhotoCraft 退出码 ${code}`),
          );
      });
    });
  }

  function serialized(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  // Each operation opens the file as its own document and closes it
  // afterwards — cold-start semantics, no state leaks between operations.
  // (An open-document LRU was tried here for LayerId stability and reverted:
  // every layer-mutating command is serve-disabled, so these pipelines run
  // on the cold CLI anyway, and the ids the bridge bakes into
  // layer.select/setProps params must come from a cold `info` — see cliInfo.)
  function withFreshDocument(path, task) {
    const target = relative(path);
    return serialized(async () => {
      await call("doc.open", { path: target });
      try {
        return await task();
      } finally {
        await call("doc.close", {}).catch(() => {});
      }
    });
  }

  // ---- cold-CLI-compatible surface --------------------------------------

  // `info` deliberately runs on a cold spawn, not the serve session: serve
  // assigns LayerIds from a session-global counter (they grow with every
  // doc.open and reset per process), while a cold process opening one file
  // assigns them deterministically. Layer-id-referencing plans (layer-action,
  // heal) always execute on the cold CLI (those commands are serve-disabled),
  // so their ids must come from the same cold id-space — inspecting through
  // serve made `layer.select LayerId(n)` stale after the counter grew.
  function cliInfo(argv) {
    return coldSpawn(argv);
  }

  async function cliConvert([, from, to]) {
    return withFreshDocument(from, async () => {
      await call("doc.save", { path: relative(to) });
      return "";
    });
  }

  async function cliRun(argv) {
    const steps = [];
    let output = null;
    let i = 2;
    while (i < argv.length) {
      if (argv[i] === "--cmd") {
        const id = argv[i + 1];
        i += 2;
        let params = {};
        if (argv[i] === "--params") {
          params = JSON.parse(argv[i + 1]);
          i += 2;
        }
        steps.push({ id, params });
      } else if (argv[i] === "--out") {
        output = argv[i + 1];
        i += 2;
      } else throw new Error(`PhotoCraft run 参数不支持：${argv[i]}`);
    }
    for (const step of steps)
      if (!(await serveAllows(step.id))) return coldSpawn(argv);
    return withFreshDocument(argv[1], async () => {
      const lines = [];
      for (const step of steps) {
        const result = await call("engine.execute", {
          command: step.id,
          params: step.params,
        });
        lines.push(JSON.stringify({ command: step.id, result }));
      }
      if (output) await call("doc.save", { path: relative(output) });
      return lines.length ? `${lines.join("\n")}\n` : "";
    });
  }

  function runCli(argv) {
    if (argv[0] === "info") return cliInfo(argv);
    if (argv[0] === "convert") return cliConvert(argv);
    if (argv[0] === "run") return cliRun(argv);
    return Promise.reject(new Error(`serve 传输不支持 CLI 子命令：${argv[0]}`));
  }

  // One open document runs the whole edit pipeline: execute every step, save
  // the editable .pcraft artifact, then render the preview and inspect the
  // result from memory — no re-open between save and preview. Steps that the
  // serve session refuses (ambient filesystem access) fall back to the cold
  // run → info → convert pipeline.
  async function runEditPlan({ input, output, preview, steps }) {
    for (const step of steps)
      if (!(await serveAllows(step.id))) {
        const argv = ["run", input];
        for (const step_ of steps)
          argv.push(
            "--cmd",
            step_.id,
            "--params",
            JSON.stringify(step_.params),
          );
        argv.push("--out", output);
        await coldSpawn(argv);
        const info = JSON.parse(await cliInfo(["info", output]));
        let previewBuffer = null;
        if (preview) {
          await cliConvert(["convert", output, `${output}.png`]);
          previewBuffer = await readFile(`${output}.png`);
        }
        return { results: [], inspect: info, previewBuffer };
      }
    const results = [];
    return withFreshDocument(input, async () => {
      for (const step of steps) {
        results.push({
          command: step.id,
          result: await call("engine.execute", {
            command: step.id,
            params: step.params,
          }),
        });
      }
      if (output) await call("doc.save", { path: relative(output) });
      const inspect = await call("doc.inspect", {});
      let previewBuffer = null;
      if (preview)
        previewBuffer = await savePngPreview(`${output}.serve-preview.png`);
      return { results, inspect, previewBuffer };
    });
  }

  // ---- live documents (slider handoff, repeated doc.render) -------------

  async function resolveLiveDocument(path) {
    const list = await call("session.list", {});
    const match = (list.documents ?? []).find(
      (document) => document.path === path,
    );
    if (!match) throw new Error("预览会话已失效，请重新预览");
    await call("doc.select", { index: match.index });
    return list.active;
  }

  function openLive(path) {
    const target = relative(path);
    return serialized(async () => {
      if (live.size >= maxLiveDocuments)
        throw new Error("活跃预览会话过多，请先关闭之前的预览");
      if ([...live.values()].some((session) => session.path === target))
        throw new Error("该图片已有活跃预览会话");
      await call("doc.open", { path: target });
      const liveId = randomUUID();
      live.set(liveId, {
        path: target,
        previewPath: `${target}.live-preview-${liveId}.png`,
      });
      return { liveId };
    });
  }

  function withLive(liveId, task) {
    const session = live.get(liveId);
    if (!session) throw new Error("预览会话不存在或已关闭");
    return serialized(async () => {
      await resolveLiveDocument(session.path);
      return task();
    });
  }

  function inspectLive(liveId) {
    return withLive(liveId, () => call("doc.inspect", {}));
  }

  function adjustLive(liveId, { layer, params }) {
    return withLive(liveId, async () => {
      if (Number.isInteger(layer))
        await call("engine.execute", {
          command: "layer.select",
          params: { layer, mode: "replace" },
        });
      await call("engine.execute", {
        command: "layer.setAdjustment",
        params,
      });
      return call("doc.inspect", {});
    });
  }

  function renderLive(liveId) {
    const { previewPath } = live.get(liveId) ?? {};
    return withLive(liveId, () => savePngPreview(previewPath));
  }

  // Saving rewrites the live document's own path; live sessions persist in
  // place so path-based index resolution keeps working.
  function saveLive(liveId) {
    return withLive(liveId, async () => {
      const session = live.get(liveId);
      await call("doc.save", { path: session.path });
      return call("doc.inspect", {});
    });
  }

  function closeLive(liveId) {
    const session = live.get(liveId);
    if (!session) return Promise.resolve();
    return serialized(async () => {
      await resolveLiveDocument(session.path).catch(() => null);
      await call("doc.close", {}).catch(() => {});
      await unlink(session.previewPath).catch(() => {});
    }).finally(() => live.delete(liveId));
  }

  function state() {
    return {
      transport: "serve",
      childAlive: Boolean(child),
      liveDocuments: live.size,
    };
  }

  return {
    runCli,
    runEditPlan,
    openLive,
    inspectLive,
    adjustLive,
    renderLive,
    saveLive,
    closeLive,
    state,
  };
}
