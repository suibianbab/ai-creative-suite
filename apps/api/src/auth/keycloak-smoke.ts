import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRemoteJWKSet } from "jose";
import pg from "pg";
import {
  AccessContextResolver,
  AccessDeniedError,
  JwtAuthProvider,
} from "./access-context.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
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
const testPassword = credentials.ACS_AUTH_TEST_PASSWORD;
const testSubject = credentials.ACS_AUTH_TEST_SUBJECT;
if (!clientSecret || !testPassword || !testSubject) {
  throw new Error("Incomplete local auth development credentials");
}
const base = "http://localhost:8180/realms/acs-dev";
const discovery = (await fetch(`${base}/.well-known/openid-configuration`).then(
  (response) => response.json(),
)) as {
  issuer: string;
  jwks_uri: string;
  token_endpoint: string;
};
assert.equal(discovery.issuer, base);
assert.equal(discovery.jwks_uri, `${base}/protocol/openid-connect/certs`);
assert.equal(discovery.token_endpoint, `${base}/protocol/openid-connect/token`);
const tokenResponse = await fetch(discovery.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "password",
    client_id: "acs-dev-cli",
    client_secret: clientSecret,
    username: "acs-dev-user",
    password: testPassword,
  }),
});
if (!tokenResponse.ok)
  throw new Error(
    `Keycloak token request failed: HTTP ${tokenResponse.status} ${JSON.stringify(await tokenResponse.json())}`,
  );
const tokenBody = (await tokenResponse.json()) as { access_token: string };
assert.equal(typeof tokenBody.access_token, "string");

const schema = `keycloak_test_${randomUUID().replaceAll("-", "")}`;
const organizationId = randomUUID();
const workspaceId = randomUUID();
const userId = randomUUID();
const admin = new pg.Client({ connectionString: databaseUrl });
const db = new pg.Pool({
  connectionString: databaseUrl,
  options: `-c search_path=${schema}`,
  max: 2,
});
let adminConnected = false;
try {
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  for (const file of [
    "0001_asset_foundation.sql",
    "0002_image_projects.sql",
    "0003_identity_memberships.sql",
  ]) {
    await db.query(
      await readFile(resolve(process.cwd(), "migrations", file), "utf8"),
    );
  }
  await db.query(
    "INSERT INTO organizations (id,slug,name) VALUES ($1,$2,'OIDC test')",
    [organizationId, `test-${organizationId}`],
  );
  await db.query(
    "INSERT INTO workspaces (id,organization_id,name) VALUES ($1,$2,'OIDC test')",
    [workspaceId, organizationId],
  );
  await db.query(
    "INSERT INTO users (id,display_name) VALUES ($1,'OIDC test')",
    [userId],
  );
  await db.query(
    "INSERT INTO auth_identities (issuer,subject,user_id) VALUES ($1,$2,$3)",
    [base, testSubject, userId],
  );
  await db.query(
    "INSERT INTO organization_memberships (organization_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [organizationId, userId],
  );
  await db.query(
    "INSERT INTO workspace_memberships (organization_id,workspace_id,user_id,role) VALUES ($1,$2,$3,'EDITOR')",
    [organizationId, workspaceId, userId],
  );
  // The production remote factory requires HTTPS. This loopback-only smoke test injects an HTTP JWKS resolver.
  const provider = new JwtAuthProvider(
    {
      issuer: base,
      audience: "acs-api",
      algorithms: ["RS256"],
      maxTokenAgeSeconds: 3600,
    },
    createRemoteJWKSet(new URL(discovery.jwks_uri)),
  );
  const resolver = new AccessContextResolver(db, provider);
  const header = `Bearer ${tokenBody.access_token}`;
  assert.equal(
    (await resolver.authorize(header, workspaceId, "write")).userId,
    userId,
  );
  await db.query(
    "UPDATE workspace_memberships SET active = false WHERE user_id = $1",
    [userId],
  );
  await assert.rejects(
    resolver.authorize(header, workspaceId, "read"),
    AccessDeniedError,
  );
  console.log(
    "PASS: real Keycloak access token, remote JWKS verification, DB membership and revocation",
  );
} finally {
  await db.end();
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
