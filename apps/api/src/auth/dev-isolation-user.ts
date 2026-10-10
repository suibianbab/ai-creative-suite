import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

if (process.env.NODE_ENV === "production")
  throw new Error("Development user provisioning is disabled in production");

const credentialsPath = resolve(process.cwd(), "../../.env.auth.local");
const credentialsText = await readFile(credentialsPath, "utf8");
const credentials = Object.fromEntries(
  credentialsText
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
const adminPassword = credentials.ACS_AUTH_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Development admin password is required");

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
    `Development admin login failed: HTTP ${tokenResponse.status}`,
  );
const { access_token: adminToken } = (await tokenResponse.json()) as {
  access_token: string;
};
const usersBase = "http://localhost:8180/admin/realms/acs-dev/users";
const headers = { authorization: `Bearer ${adminToken}` };
let usersResponse = await fetch(
  `${usersBase}?username=acs-dev-isolated&exact=true`,
  { headers },
);
if (!usersResponse.ok)
  throw new Error(
    `Development user lookup failed: HTTP ${usersResponse.status}`,
  );
let users = (await usersResponse.json()) as Array<{
  id: string;
  username: string;
}>;
if (users.length === 0) {
  const createResponse = await fetch(usersBase, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      username: "acs-dev-isolated",
      firstName: "ACS",
      lastName: "Isolation Test",
      email: "acs-dev-isolated@example.invalid",
      emailVerified: true,
      enabled: true,
      requiredActions: [],
    }),
  });
  if (createResponse.status !== 201)
    throw new Error(
      `Development user creation failed: HTTP ${createResponse.status}`,
    );
  usersResponse = await fetch(
    `${usersBase}?username=acs-dev-isolated&exact=true`,
    { headers },
  );
  if (!usersResponse.ok)
    throw new Error(
      `Development user lookup failed: HTTP ${usersResponse.status}`,
    );
  users = (await usersResponse.json()) as typeof users;
}
if (users.length !== 1 || users[0]?.username !== "acs-dev-isolated")
  throw new Error("Expected exactly one isolated development user");

if (!credentials.ACS_AUTH_ISOLATED_PASSWORD) {
  const password = randomBytes(24).toString("base64url");
  const resetResponse = await fetch(
    `${usersBase}/${users[0].id}/reset-password`,
    {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        type: "password",
        value: password,
        temporary: false,
      }),
    },
  );
  if (resetResponse.status !== 204)
    throw new Error(
      `Development password setup failed: HTTP ${resetResponse.status}`,
    );
  await writeFile(
    credentialsPath,
    `${credentialsText.trimEnd()}\nACS_AUTH_ISOLATED_PASSWORD=${password}\n`,
  );
}
console.log("Isolated development user ready without workspace membership");
