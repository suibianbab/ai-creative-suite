import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import {
  ImageProjectHttpController,
  ImageProjectHttpGuard,
} from "./image-projects/image-project-http.controller.js";
import { ImageProjectHttpService } from "./image-projects/image-project-http.service.js";
import { PhotoCraftCreditHttpController } from "./image-projects/photocraft-credit-http.controller.js";
import { PhotoCraftEditJobHttpController } from "./image-projects/photocraft-edit-job-http.controller.js";
import { PhotoCraftProjectHttpController } from "./image-projects/photocraft-project-http.controller.js";
import { PhotoCraftQualityReviewHttpController } from "./image-projects/photocraft-quality-review-http.controller.js";
import { ReadinessService } from "./readiness.service.js";

@Module({
  controllers: [
    HealthController,
    ImageProjectHttpController,
    PhotoCraftProjectHttpController,
    PhotoCraftEditJobHttpController,
    PhotoCraftCreditHttpController,
    PhotoCraftQualityReviewHttpController,
  ],
  providers: [ReadinessService, ImageProjectHttpService, ImageProjectHttpGuard],
})
export class AppModule {}
