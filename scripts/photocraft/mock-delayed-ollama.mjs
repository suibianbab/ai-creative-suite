// Development-only endpoint for the UI-029 stale-plan browser check.
import { createServer } from "node:http";

const plan = {
  operation: "adjust",
  adjustment: "brightness",
  amount: 10,
  target: "whole-image",
  protectLabel: false,
  unsupported: "",
};

createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/api/chat") {
    response.writeHead(404).end();
    return;
  }
  request.resume();
  setTimeout(() => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ message: { content: JSON.stringify(plan) } }),
    );
  }, 3000);
}).listen(11434, "127.0.0.1");
