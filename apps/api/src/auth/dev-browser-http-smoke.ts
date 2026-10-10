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
const adminPassword = credentials.ACS_AUTH_ADMIN_PASSWORD;
const subject = credentials.ACS_AUTH_TEST_SUBJECT;
if (
  !clientSecret ||
  !password ||
  !adminPassword ||
  !subject ||
  !process.env.DATABASE_URL
)
  throw new Error("Development OIDC credentials and database URL are required");
const corsResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: "OPTIONS",
  headers: {
    origin: "http://localhost:3000",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  },
});
assert.equal(corsResponse.status, 200);
assert.equal(
  corsResponse.headers.get("access-control-allow-origin"),
  "http://localhost:3000",
);
const adminResponse = await fetch(
  "http://localhost:8180/realms/master/protocol/openid-connect/token",
  {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: "acs-dev-admin",
      password: adminPassword,
    }),
  },
);
assert.equal(adminResponse.status, 200);
const { access_token: adminToken } = (await adminResponse.json()) as {
  access_token: string;
};
const clientsResponse = await fetch(
  "http://localhost:8180/admin/realms/acs-dev/clients?clientId=acs-dev-web",
  {
    headers: { authorization: `Bearer ${adminToken}` },
  },
);
assert.equal(clientsResponse.status, 200);
const clients = (await clientsResponse.json()) as Array<{ id: string }>;
assert.equal(clients.length, 1);
const clientResponse = await fetch(
  `http://localhost:8180/admin/realms/acs-dev/clients/${clients[0]?.id}`,
  {
    headers: { authorization: `Bearer ${adminToken}` },
  },
);
assert.equal(clientResponse.status, 200);
const publicClient = (await clientResponse.json()) as {
  publicClient: boolean;
  standardFlowEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  redirectUris: string[];
  webOrigins: string[];
  attributes: Record<string, string>;
  protocolMappers?: Array<{ name: string; config: Record<string, string> }>;
};
assert.equal(publicClient.publicClient, true);
assert.equal(publicClient.standardFlowEnabled, true);
assert.equal(publicClient.directAccessGrantsEnabled, false);
assert.deepEqual(publicClient.redirectUris, [
  "http://localhost:3000/image-studio",
]);
assert.deepEqual(publicClient.webOrigins, ["http://localhost:3000"]);
assert.equal(publicClient.attributes["pkce.code.challenge.method"], "S256");
assert.ok(
  publicClient.protocolMappers?.some(
    (mapper) =>
      mapper.name === "acs-api-audience" &&
      mapper.config["included.custom.audience"] === "acs-api" &&
      !mapper.config["included.client.audience"],
  ),
);
const exampleResponse = await fetch(
  `http://localhost:8180/admin/realms/acs-dev/clients/${clients[0]?.id}/evaluate-scopes/generate-example-access-token?scope=openid&userId=${encodeURIComponent(subject)}`,
  { headers: { authorization: `Bearer ${adminToken}` } },
);
assert.equal(exampleResponse.status, 200);
const exampleToken = (await exampleResponse.json()) as {
  aud?: string | string[];
};
assert.ok(
  Array.isArray(exampleToken.aud)
    ? exampleToken.aud.includes("acs-api")
    : exampleToken.aud === "acs-api",
  "Public browser token must include the API audience",
);
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
    "PASS: public PKCE client and CORS configuration; real Keycloak token reaches the browser workspace HTTP API",
  );
} finally {
  await app.close();
  await db.end();
}
