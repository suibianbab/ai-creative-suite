import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import type pg from "pg";
import type { TenantScope } from "../assets/asset-foundation.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOKEN_LENGTH = 8192;

export class AuthenticationError extends Error {}
export class AccessDeniedError extends Error {}

export type VerifiedIdentity = Readonly<{ issuer: string; subject: string }>;
export type WorkspaceAction = "read" | "write";
export type AccessContext = Readonly<{
  userId: string;
  scope: TenantScope;
  organizationRole: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  workspaceRole: "OWNER" | "EDITOR" | "VIEWER";
}>;

export interface AuthProvider {
  verifyAuthorizationHeader(
    header: string | undefined,
  ): Promise<VerifiedIdentity>;
}

export type JwtProviderConfig = Readonly<{
  issuer: string;
  audience: string;
  algorithms: readonly ("RS256" | "ES256")[];
  maxTokenAgeSeconds: number;
}>;

function requireConfig(config: JwtProviderConfig): void {
  if (
    !config.issuer ||
    !config.audience ||
    !config.algorithms.length ||
    config.algorithms.some(
      (algorithm) => algorithm !== "RS256" && algorithm !== "ES256",
    ) ||
    !Number.isInteger(config.maxTokenAgeSeconds) ||
    config.maxTokenAgeSeconds < 60 ||
    config.maxTokenAgeSeconds > 86400
  ) {
    throw new Error("Invalid JWT provider configuration");
  }
}

/** Explicitly configured key source; no token-controlled key URL or issuer discovery. */
export class JwtAuthProvider implements AuthProvider {
  constructor(
    private readonly config: JwtProviderConfig,
    private readonly keys: JWTVerifyGetKey,
  ) {
    requireConfig(config);
  }

  static remote(config: JwtProviderConfig, jwksUrl: string): JwtAuthProvider {
    const url = new URL(jwksUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error(
        "JWKS URL must be an HTTPS URL without credentials or fragment",
      );
    }
    return new JwtAuthProvider(config, createRemoteJWKSet(url));
  }

  static local(
    config: JwtProviderConfig,
    publicKeys: JSONWebKeySet,
  ): JwtAuthProvider {
    if (
      !publicKeys.keys.length ||
      publicKeys.keys.some((key) => key.kty === "oct" || "d" in key)
    ) {
      throw new Error("Local JWKS must contain public asymmetric keys only");
    }
    return new JwtAuthProvider(config, createLocalJWKSet(publicKeys));
  }

  async verifyAuthorizationHeader(
    header: string | undefined,
  ): Promise<VerifiedIdentity> {
    const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header ?? "");
    const token = match?.[1];
    if (!token || token.length > MAX_TOKEN_LENGTH)
      throw new AuthenticationError("Invalid bearer token");
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.config.algorithms],
        maxTokenAge: this.config.maxTokenAgeSeconds,
        clockTolerance: 5,
      });
      if (
        typeof payload.exp !== "number" ||
        typeof payload.iat !== "number" ||
        typeof payload.sub !== "string" ||
        !payload.sub ||
        payload.sub.length > 500
      ) {
        throw new AuthenticationError("Required JWT claims are missing");
      }
      return { issuer: this.config.issuer, subject: payload.sub };
    } catch {
      throw new AuthenticationError("Invalid bearer token");
    }
  }
}

type AccessRow = {
  user_id: string;
  organization_id: string;
  workspace_id: string;
  organization_role: AccessContext["organizationRole"];
  workspace_role: AccessContext["workspaceRole"];
};

/** Workspaces are selectors only; identity and roles come from verified token plus current DB rows. */
export class AccessContextResolver {
  constructor(
    private readonly db: pg.Pool,
    private readonly provider: AuthProvider,
  ) {}

  async authorize(
    authorizationHeader: string | undefined,
    workspaceId: string,
    action: WorkspaceAction,
  ): Promise<AccessContext> {
    const identity =
      await this.provider.verifyAuthorizationHeader(authorizationHeader);
    if (!UUID.test(workspaceId) || (action !== "read" && action !== "write")) {
      throw new AccessDeniedError("Workspace access denied");
    }
    const result = await this.db.query<AccessRow>(
      `SELECT u.id AS user_id, wm.organization_id, wm.workspace_id,
              om.role AS organization_role, wm.role AS workspace_role
       FROM auth_identities i
       JOIN users u ON u.id = i.user_id AND NOT u.disabled
       JOIN workspace_memberships wm ON wm.user_id = u.id AND wm.workspace_id = $3 AND wm.active
       JOIN organization_memberships om ON om.organization_id = wm.organization_id
         AND om.user_id = u.id AND om.active
       WHERE i.issuer = $1 AND i.subject = $2`,
      [identity.issuer, identity.subject, workspaceId],
    );
    const row = result.rows[0];
    if (
      !row ||
      (action === "write" &&
        (row.workspace_role === "VIEWER" || row.organization_role === "VIEWER"))
    ) {
      throw new AccessDeniedError("Workspace access denied");
    }
    return {
      userId: row.user_id,
      scope: {
        organizationId: row.organization_id,
        workspaceId: row.workspace_id,
      },
      organizationRole: row.organization_role,
      workspaceRole: row.workspace_role,
    };
  }
}
