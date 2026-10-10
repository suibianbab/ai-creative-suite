import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import {
  ImageProjectHttpController,
  ImageProjectHttpGuard,
} from "./image-projects/image-project-http.controller.js";
import { ImageProjectHttpService } from "./image-projects/image-project-http.service.js";
import { ReadinessService } from "./readiness.service.js";

@Module({
  controllers: [HealthController, ImageProjectHttpController],
  providers: [ReadinessService, ImageProjectHttpService, ImageProjectHttpGuard],
})
export class AppModule {}
