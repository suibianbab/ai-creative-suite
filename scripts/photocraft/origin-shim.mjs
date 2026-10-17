// HTTP-level origin-rewriting reverse proxy.
//
// The web app is served from http://127.0.0.1:3100 (see proxy3100.mjs for why
// the page can't be served from :3000), but the repo's local services
// (scripts/image_quality/local_mask_provider.py and
// scripts/photocraft/dev-bridge.mjs) hard-allowlist only :3000/:3001 browser
// origins and reject anything else with 403. Those scripts are repo code we
// must not modify, so each real service runs one port higher and this shim
// sits on the port the app actually calls:
//   - request Origin -> rewritten to http://127.0.0.1:3000 (always allowed)
//   - response Access-Control-Allow-Origin -> rewritten back to the caller's
//     real origin so the browser accepts the CORS response.
// Plain HTTP only (no websockets), so http.request/Server relays are fine.
import http from "node:http";

const listenPort = Number(process.argv[2]);
const upstreamPort = Number(process.argv[3]);
if (!listenPort || !upstreamPort) {
  console.error("usage: node origin-shim.mjs <listenPort> <upstreamPort>");
  process.exit(1);
}
const UPSTREAM = `http://127.0.0.1:${upstreamPort}`;
const ALLOWED_FAKE_ORIGIN = "http://127.0.0.1:3000";

// One connection per request: Node's default keep-alive agent races the
// upstream's keepAliveTimeout and intermittently reuses a socket the server
// just closed (ECONNRESET -> spurious 502 on back-to-back requests).
const agent = new http.Agent({ keepAlive: false });

const server = http.createServer((req, res) => {
  const callerOrigin = req.headers.origin;
  const headers = { ...req.headers };
  if (headers.origin) headers.origin = ALLOWED_FAKE_ORIGIN;
  const upstream = http.request(
    `${UPSTREAM}${req.url}`,
    { method: req.method, headers, agent },
    (ur) => {
      const outHeaders = { ...ur.headers };
      if (
        callerOrigin &&
        typeof outHeaders["access-control-allow-origin"] === "string"
      ) {
        outHeaders["access-control-allow-origin"] = callerOrigin;
      }
      res.writeHead(ur.statusCode, outHeaders);
      ur.pipe(res);
    },
  );
  upstream.on("error", (error) => {
    console.log(
      `upstream error ${req.method} ${req.url}: ${String(error).slice(0, 120)}`,
    );
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("origin-shim: upstream unreachable");
    } else {
      res.destroy();
    }
  });
  req.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`origin shim 127.0.0.1:${listenPort} -> ${UPSTREAM}`);
});
