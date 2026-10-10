export type CloudConfig = Readonly<{
  issuer: string;
  clientId: string;
  apiOrigin: string;
  workspaceId: string;
}>;

type CloudSession = { accessToken: string; expiresAt: number };
const SESSION_KEY = "acs-cloud-session-v1";
const LOGIN_KEY = "acs-cloud-login-v1";

export function cloudConfig(): CloudConfig | null {
  const issuer = process.env.NEXT_PUBLIC_AUTH_ISSUER;
  const clientId = process.env.NEXT_PUBLIC_AUTH_CLIENT_ID;
  const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN;
  const workspaceId = process.env.NEXT_PUBLIC_WORKSPACE_ID;
  if (!issuer || !clientId || !apiOrigin || !workspaceId) return null;
  return { issuer, clientId, apiOrigin, workspaceId };
}

export function cloudSession(): CloudSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as CloudSession;
    if (
      typeof value.accessToken !== "string" ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= Date.now() + 15_000
    ) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function cloudLogout(): void {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LOGIN_KEY);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function redirectUri(): string {
  return `${window.location.origin}/image-studio`;
}

export async function beginCloudLogin(config: CloudConfig): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const state = crypto.randomUUID();
  sessionStorage.setItem(
    LOGIN_KEY,
    JSON.stringify({ verifier, state, at: Date.now() }),
  );
  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    scope: "openid",
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  window.location.assign(url);
}

export async function finishCloudLogin(config: CloudConfig): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code && !params.has("error")) return false;
  const stored = sessionStorage.getItem(LOGIN_KEY);
  sessionStorage.removeItem(LOGIN_KEY);
  window.history.replaceState(null, "", window.location.pathname);
  if (params.has("error")) throw new Error("登录已取消或身份服务拒绝了请求");
  const attempt = stored
    ? (JSON.parse(stored) as { verifier: string; state: string; at: number })
    : null;
  if (
    !attempt ||
    attempt.state !== params.get("state") ||
    Date.now() - attempt.at > 600_000
  )
    throw new Error("登录状态已过期，请重新登录");
  const response = await fetch(
    `${config.issuer}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code: code!,
        redirect_uri: redirectUri(),
        code_verifier: attempt.verifier,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`登录令牌交换失败（HTTP ${response.status}）`);
  const token = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (
    typeof token.access_token !== "string" ||
    typeof token.expires_in !== "number"
  )
    throw new Error("身份服务返回了无效令牌");
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: token.access_token,
      expiresAt: Date.now() + token.expires_in * 1000,
    }),
  );
  return true;
}
