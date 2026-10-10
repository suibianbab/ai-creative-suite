import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

if (process.env.NODE_ENV === "production")
  throw new Error("Development provisioning is disabled in production");
const issuer = "http://localhost:8180/realms/acs-dev";
const authFile = resolve(process.cwd(), "../../.env.auth.local");
const credentials = Object.fromEntries(
  (await readFile(authFile, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const adminPassword = credentials.ACS_AUTH_ADMIN_PASSWORD;
const subject = credentials.ACS_AUTH_TEST_SUBJECT;
const databaseUrl = process.env.DATABASE_URL;
if (!adminPassword || !subject || !databaseUrl)
  throw new Error(
    "Local development credentials and DATABASE_URL are required",
  );

const tokenResponse = await fetch(
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
if (!tokenResponse.ok)
  throw new Error(
    `Development admin token failed: HTTP ${tokenResponse.status}`,
  );
const { access_token: adminToken } = (await tokenResponse.json()) as {
  access_token: string;
};
const adminBase = "http://localhost:8180/admin/realms/acs-dev/clients";
const existingResponse = await fetch(`${adminBase}?clientId=acs-dev-web`, {
  headers: { authorization: `Bearer ${adminToken}` },
});
if (!existingResponse.ok)
  throw new Error(
    `Development client lookup failed: HTTP ${existingResponse.status}`,
  );
const existing = (await existingResponse.json()) as Array<{ id: string }>;
if (existing.length === 0) {
  const response = await fetch(adminBase, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      clientId: "acs-dev-web",
      name: "ACS development browser",
      enabled: true,
      protocol: "openid-connect",
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ["http://localhost:3000/image-studio"],
      webOrigins: ["http://localhost:3000"],
      attributes: { "pkce.code.challenge.method": "S256" },
      protocolMappers: [
        {
          name: "acs-api-audience",
          protocol: "openid-connect",
          protocolMapper: "oidc-audience-mapper",
          config: {
            "included.client.audience": "acs-api",
            "id.token.claim": "false",
            "access.token.claim": "true",
          },
        },
      ],
    }),
  });
  if (response.status !== 201)
    throw new Error(
      `Development browser client creation failed: HTTP ${response.status}`,
    );
}

const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });
let workspaceId: string;
try {
  const organizationId = randomUUID();
  const organization = await db.query<{ id: string }>(
    `INSERT INTO organizations (id,slug,name) VALUES ($1,'acs-dev-browser','ACS browser development')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [organizationId],
  );
  const org = organization.rows[0]!.id;
  const prior = await db.query<{ id: string }>(
    "SELECT id FROM workspaces WHERE organization_id = $1 AND name = 'Image Studio development' LIMIT 1",
    [org],
  );
  workspaceId = prior.rows[0]?.id ?? randomUUID();
  if (!prior.rows[0])
    await db.query(
      "INSERT INTO workspaces (id,organization_id,name) VALUES ($1,$2,'Image Studio development')",
      [workspaceId, org],
    );
  const identity = await db.query<{ user_id: string }>(
    "SELECT user_id FROM auth_identities WHERE issuer = $1 AND subject = $2",
    [issuer, subject],
  );
  const userId = identity.rows[0]?.user_id ?? randomUUID();
  if (!identity.rows[0]) {
    await db.query(
      "INSERT INTO users (id,display_name) VALUES ($1,'ACS development user')",
      [userId],
    );
    await db.query(
      "INSERT INTO auth_identities (issuer,subject,user_id) VALUES ($1,$2,$3)",
      [issuer, subject, userId],
    );
  }
  await db.query(
    `INSERT INTO organization_memberships (organization_id,user_id,role,active)
     VALUES ($1,$2,'OWNER',true)
     ON CONFLICT (organization_id,user_id) DO UPDATE SET active = true`,
    [org, userId],
  );
  await db.query(
    `INSERT INTO workspace_memberships (organization_id,workspace_id,user_id,role,active)
     VALUES ($1,$2,$3,'OWNER',true)
     ON CONFLICT (organization_id,workspace_id,user_id) DO UPDATE SET active = true`,
    [org, workspaceId, userId],
  );
} finally {
  await db.end();
}

async function writeEnv(path: string, entries: Record<string, string>) {
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch {
    /* first provisioning */
  }
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    content = pattern.test(content)
      ? content.replace(pattern, line)
      : `${content.trimEnd()}\n${line}\n`;
  }
  await writeFile(path, content);
}
await writeEnv(resolve(process.cwd(), "../../.env"), {
  API_HOST: "127.0.0.1",
  AUTH_ISSUER: issuer,
  AUTH_AUDIENCE: "acs-api",
  AUTH_JWKS_URL: `${issuer}/protocol/openid-connect/certs`,
  AUTH_ALLOW_INSECURE_LOOPBACK: "true",
});
await writeEnv(resolve(process.cwd(), "../web/.env.local"), {
  NEXT_PUBLIC_AUTH_ISSUER: issuer,
  NEXT_PUBLIC_AUTH_CLIENT_ID: "acs-dev-web",
  NEXT_PUBLIC_API_ORIGIN: "http://localhost:4000",
  NEXT_PUBLIC_WORKSPACE_ID: workspaceId,
});
console.log(`Development browser OIDC and workspace ready: ${workspaceId}`);
