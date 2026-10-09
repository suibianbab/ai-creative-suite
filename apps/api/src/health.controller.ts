import type { LivenessResponse, ReadinessResponse } from "@acs/shared";
import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ReadinessService } from "./readiness.service.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(ReadinessService) private readonly readiness: ReadinessService,
  ) {}

  @Get("live")
  live(): LivenessResponse {
    return {
      service: "api",
      status: "ok",
      version: "0.0.0",
    };
  }

  @Get("ready")
  async ready(): Promise<ReadinessResponse> {
    const result = await this.readiness.check();
    if (result.status !== "ready") {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
