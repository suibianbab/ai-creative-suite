import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
const adminPassword = credentials.ACS_AUTH_ADMIN_PASSWORD;
if (!adminPassword) throw new Error("Missing development admin password");

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
  throw new Error(`Keycloak admin login failed: HTTP ${tokenResponse.status}`);
const { access_token: token } = (await tokenResponse.json()) as {
  access_token: string;
};
const url =
  "http://localhost:8180/admin/realms/acs-dev/users?username=acs-dev-user&exact=true";
const usersResponse = await fetch(url, {
  headers: { authorization: `Bearer ${token}` },
});
if (!usersResponse.ok)
  throw new Error(`Keycloak user lookup failed: HTTP ${usersResponse.status}`);
const users = (await usersResponse.json()) as Array<{
  id: string;
  username: string;
}>;
if (users.length !== 1 || users[0]?.username !== "acs-dev-user") {
  throw new Error("Expected exactly one development user");
}
const update = await fetch(
  `http://localhost:8180/admin/realms/acs-dev/users/${users[0].id}`,
  {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      firstName: "ACS",
      lastName: "Developer",
      email: "acs-dev-user@example.invalid",
      emailVerified: true,
      requiredActions: [],
    }),
  },
);
if (!update.ok)
  throw new Error(`Keycloak user update failed: HTTP ${update.status}`);
console.log("Development Keycloak user profile ready");
