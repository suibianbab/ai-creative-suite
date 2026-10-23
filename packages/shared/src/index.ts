export const PRODUCT_TYPES = ["IMAGE", "MOTION", "INTERIOR"] as const;
export * from "./color-contrast.js";
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const DEPLOYMENT_MODES = ["CLOUD", "ENTERPRISE", "AIRGAP"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export interface LivenessResponse {
  service: "api";
  status: "ok";
  version: string;
}

export type DependencyStatus = "ok" | "unavailable" | "unconfigured";

export interface ReadinessResponse {
  service: "api";
  status: "ready" | "not_ready";
  checks: {
    postgres: DependencyStatus;
    redis: DependencyStatus;
    objectstore: DependencyStatus;
  };
}
