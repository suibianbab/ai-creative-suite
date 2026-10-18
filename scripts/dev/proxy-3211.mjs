// Raw TCP reverse proxy 127.0.0.1:3211 -> 127.0.0.1:3210 (dev server).
//
// Why this exists: the Next 16 (Turbopack) dev server's HMR websocket
// handshake breaks when the browser offers permessage-deflate (every real
// browser does; Node 22.22.2 server side hangs the 101), so the HMR socket
// never connects and the app tree never hydrates -- dev pages render but are
// completely inert. Node's http.request also fails to parse the upstream 101,
// so this relays raw TCP and only rewrites headers per request:
//   - strip "sec-websocket-extensions: ..." (fixes the broken handshake)
//   - for GET /_next/hmr* also rewrite origin/host to :3000 (Next validates
//     the Origin port; static chunks 403 if Host is rewritten, so scope it)
//   - for /api/* drop the Origin header (routes 403 an Origin that mismatches
//     the request-URL origin through this proxy)
// Header rewriting is per REQUEST, not per connection: browsers reuse
// keep-alive connections, and a request reusing a connection must get the
// same header surgery as the first one (an earlier first-request-only
// implementation made every 2nd+ /api/* call 403 with 跨站请求已拒绝,
// depending on connection reuse order).
// After a websocket upgrade (or a chunked/unknown-framing request) the
// connection switches to raw tunnel mode: no further framing is attempted.
import net from "node:net";

const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = 3210;
const LISTEN_PORT = 3211;

const server = net.createServer((client) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST);
  let pending = Buffer.alloc(0);
  let bodyRemaining = 0; // bytes left in the current request's body
  let rawMode = false;

  const forwardRaw = () => {
    rawMode = true;
    if (pending.length) {
      upstream.write(pending);
      pending = Buffer.alloc(0);
    }
  };

  const handleHead = () => {
    const end = pending.indexOf("\r\n\r\n");
    const head = pending.subarray(0, end).toString("latin1");
    pending = pending.subarray(end + 4);
    const firstLine = head.split("\r\n")[0];
    const isHmr = /^GET\s+\/_next\/hmr/.test(firstLine);
    const isApi = /^\w+\s+\/api\//.test(firstLine);
    const lines = head.split("\r\n");
    const kept = [lines[0]];
    let contentLength = 0;
    let upgrade = false;
    let chunked = false;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();
      if (lower.startsWith("content-length:"))
        contentLength = Number(lower.slice(15).trim()) || 0;
      if (lower.startsWith("transfer-encoding:") && lower.includes("chunked"))
        chunked = true;
      if (lower.startsWith("upgrade:")) upgrade = true;
      if (lower.startsWith("sec-websocket-extensions:")) continue; // never forward
      if (isApi && lower.startsWith("origin:")) continue;
      // The HMR endpoint rejects upgrades that carry an Origin header at all
      // (even one matching the dev origin) and hangs on deflate offers;
      // dropping both makes the handshake succeed.
      if (isHmr && lower.startsWith("origin:")) continue;
      if (isHmr && lower.startsWith("host:")) {
        kept.push(`Host: ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
        continue;
      }
      kept.push(line);
    }
    if (isHmr)
      console.log(
        `>> ${kept.join("\r\n").replace(/\r\n/g, " | ").slice(0, 160)}`,
      );
    upstream.write(Buffer.from(`${kept.join("\r\n")}\r\n\r\n`, "latin1"));
    if (upgrade || chunked) {
      // Tunnel: websocket frames / chunked bodies must not be re-framed.
      forwardRaw();
      return;
    }
    bodyRemaining = contentLength;
  };

  const onClientData = (chunk) => {
    if (rawMode) {
      upstream.write(chunk);
      return;
    }
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (bodyRemaining > 0) {
        const take = Math.min(bodyRemaining, pending.length);
        upstream.write(pending.subarray(0, take));
        pending = pending.subarray(take);
        bodyRemaining -= take;
        if (bodyRemaining > 0) return; // need more body bytes
      }
      const end = pending.indexOf("\r\n\r\n");
      if (end === -1) {
        if (pending.length > 65536) forwardRaw();
        return;
      }
      handleHead();
      if (rawMode) return;
    }
  };

  let respLogged = false;
  client.on("data", onClientData);
  upstream.on("data", (c) => {
    if (!respLogged) {
      respLogged = true;
      console.log(
        `<< ${c.subarray(0, 160).toString("latin1").replace(/\r\n/g, " | ")}`,
      );
    }
    client.write(c);
  });
  const kill = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", kill);
  upstream.on("error", kill);
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(
    `raw tcp proxy 127.0.0.1:${LISTEN_PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT} (per-request framing)`,
  );
});
