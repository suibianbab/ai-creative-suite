import "reflect-metadata";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import pg from "pg";
import { AppModule } from "../app.module.js";

const issuer = "http://localhost:8180/realms/acs-dev";
const credentialsText = await readFile(
  resolve(process.cwd(), "../../.env.auth.local"),
  "utf8",
);
const credentials = Object.fromEntries(
  credentialsText
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const clientSecret = credentials.ACS_AUTH_CLIENT_SECRET;
const password = credentials.ACS_AUTH_TEST_PASSWORD;
if (!clientSecret || !password || !process.env.DATABASE_URL)
  throw new Error("Development OIDC credentials and database URL are required");
const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "password",
    client_id: "acs-dev-cli",
    client_secret: clientSecret,
    username: "acs-dev-user",
    password,
  }),
});
assert.equal(tokenResponse.status, 200);
const { access_token: token } = (await tokenResponse.json()) as {
  access_token: string;
};
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const app = await NestFactory.create(AppModule, { logger: false });
try {
  const workspace = await db.query<{ id: string }>(
    `SELECT w.id FROM workspaces w JOIN organizations o ON o.id = w.organization_id
     WHERE o.slug = 'acs-dev-browser' AND w.name = 'Image Studio development'`,
  );
  const workspaceId = workspace.rows[0]?.id;
  assert.ok(
    workspaceId,
    "Development browser workspace has not been provisioned",
  );
  await app.listen(0, "127.0.0.1");
  const url = `${await app.getUrl()}/workspaces/${workspaceId}/image-projects`;
  assert.equal((await fetch(url)).status, 401);
  const authorized = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authorized.status, 200);
  assert.ok(Array.isArray(await authorized.json()));
  console.log(
    "PASS: real Keycloak access token reaches the configured browser workspace HTTP API",
  );
} finally {
  await app.close();
  await db.end();
}
