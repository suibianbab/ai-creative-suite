import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import {
  AccessContextResolver,
  AccessDeniedError,
  AuthenticationError,
  JwtAuthProvider,
} from "./access-context.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const schema = `auth_test_${randomUUID().replaceAll("-", "")}`;
const organizationA = randomUUID();
const organizationB = randomUUID();
const workspaceA = randomUUID();
const workspaceB = randomUUID();
const userA = randomUUID();
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
    "INSERT INTO organizations (id,slug,name) VALUES ($1,$2,'A'),($3,$4,'B')",
    [
      organizationA,
      `test-${organizationA}`,
      organizationB,
      `test-${organizationB}`,
    ],
  );
  await db.query(
    "INSERT INTO workspaces (id,organization_id,name) VALUES ($1,$2,'A'),($3,$4,'B')",
    [workspaceA, organizationA, workspaceB, organizationB],
  );
  await db.query("INSERT INTO users (id,display_name) VALUES ($1,'Alice')", [
    userA,
  ]);
  await db.query(
    "INSERT INTO auth_identities (issuer,subject,user_id) VALUES ($1,'alice',$2)",
    ["https://issuer.example", userA],
  );
  await db.query(
    "INSERT INTO organization_memberships (organization_id,user_id,role) VALUES ($1,$2,'MEMBER')",
    [organizationA, userA],
  );
  await db.query(
    "INSERT INTO workspace_memberships (organization_id,workspace_id,user_id,role) VALUES ($1,$2,$3,'EDITOR')",
    [organizationA, workspaceA, userA],
  );

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  const config = {
    issuer: "https://issuer.example",
    audience: "acs-api",
    algorithms: ["RS256"] as const,
    maxTokenAgeSeconds: 3600,
  };
  const provider = JwtAuthProvider.local(config, { keys: [jwk] });
  const resolver = new AccessContextResolver(db, provider);
  const token = await new SignJWT({
    organizationId: organizationB,
    workspaceId: workspaceB,
    role: "OWNER",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  const header = `Bearer ${token}`;
  assert.equal(
    (await resolver.authorize(header, workspaceA, "write")).scope
      .organizationId,
    organizationA,
  );
  await assert.rejects(
    resolver.authorize(header, workspaceB, "read"),
    AccessDeniedError,
  );
  await assert.rejects(
    resolver.authorize(undefined, workspaceA, "read"),
    AuthenticationError,
  );
  await assert.rejects(
    resolver.authorize(`Bearer ${token} extra`, workspaceA, "read"),
    AuthenticationError,
  );
  assert.throws(() =>
    JwtAuthProvider.remote(config, "http://issuer.example/jwks"),
  );

  const wrongAudience = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience("other-api")
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  await assert.rejects(
    resolver.authorize(`Bearer ${wrongAudience}`, workspaceA, "read"),
    AuthenticationError,
  );
  const wrongIssuer = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://attacker.example")
    .setAudience(config.audience)
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  await assert.rejects(
    resolver.authorize(`Bearer ${wrongIssuer}`, workspaceA, "read"),
    AuthenticationError,
  );
  const { privateKey: otherPrivate } = await generateKeyPair("RS256");
  const badSignature = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject("alice")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(otherPrivate);
  await assert.rejects(
    resolver.authorize(`Bearer ${badSignature}`, workspaceA, "read"),
    AuthenticationError,
  );
  const noExpiry = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject("alice")
    .setIssuedAt()
    .sign(privateKey);
  await assert.rejects(
    resolver.authorize(`Bearer ${noExpiry}`, workspaceA, "read"),
    AuthenticationError,
  );
  const expired = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject("alice")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
    .sign(privateKey);
  await assert.rejects(
    resolver.authorize(`Bearer ${expired}`, workspaceA, "read"),
    AuthenticationError,
  );
  const unknownSubject = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject("unknown")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  await assert.rejects(
    resolver.authorize(`Bearer ${unknownSubject}`, workspaceA, "read"),
    AccessDeniedError,
  );

  await db.query(
    "UPDATE workspace_memberships SET role = 'VIEWER' WHERE user_id = $1",
    [userA],
  );
  assert.equal(
    (await resolver.authorize(header, workspaceA, "read")).workspaceRole,
    "VIEWER",
  );
  await assert.rejects(
    resolver.authorize(header, workspaceA, "write"),
    AccessDeniedError,
  );
  await db.query(
    "UPDATE workspace_memberships SET role = 'EDITOR' WHERE user_id = $1",
    [userA],
  );
  await db.query(
    "UPDATE organization_memberships SET role = 'VIEWER' WHERE user_id = $1",
    [userA],
  );
  await assert.rejects(
    resolver.authorize(header, workspaceA, "write"),
    AccessDeniedError,
  );
  await db.query(
    "UPDATE organization_memberships SET role = 'MEMBER', active = false WHERE user_id = $1",
    [userA],
  );
  await assert.rejects(
    resolver.authorize(header, workspaceA, "read"),
    AccessDeniedError,
  );
  await db.query(
    "UPDATE organization_memberships SET active = true WHERE user_id = $1",
    [userA],
  );
  await db.query(
    "UPDATE workspace_memberships SET active = false WHERE user_id = $1",
    [userA],
  );
  await assert.rejects(
    resolver.authorize(header, workspaceA, "read"),
    AccessDeniedError,
  );
  await db.query(
    "UPDATE workspace_memberships SET active = true WHERE user_id = $1",
    [userA],
  );
  await db.query("UPDATE users SET disabled = true WHERE id = $1", [userA]);
  await assert.rejects(
    resolver.authorize(header, workspaceA, "read"),
    AccessDeniedError,
  );
  console.log(
    "PASS: JWT signature/claims, token-claim privilege rejection, DB roles and immediate revocation, tenant isolation",
  );
} finally {
  await db.end();
  if (adminConnected) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}
