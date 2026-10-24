#!/usr/bin/env node
// VID-046 entry point: the live variant of the gallery extension audit.
// The QA registry validator requires the script path as the last argv
// element, so the --live flag lives behind this wrapper.
process.env.BASE_URL ??= "http://localhost:3210";
process.argv.push("--live");
await import("./audit-gallery-extensions.mjs");
