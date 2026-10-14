import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ImageProjectHttpGuard,
  routeError,
} from "./image-project-http.controller.js";
import { ImageProjectHttpService } from "./image-project-http.service.js";
import type { QualityGrade } from "./photocraft-quality-reviews.js";

type RequestHeaders = { headers: { authorization?: string } };

@Controller(
  "workspaces/:workspaceId/photocraft-projects/:projectId/reviews/:version",
)
@UseGuards(ImageProjectHttpGuard)
export class PhotoCraftQualityReviewHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("version") version: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      return await this.service
        .get()
        .photocraftReviews.list(context.scope, projectId, Number(version));
    } catch (error) {
      routeError(error);
    }
  }

  @Post()
  @Header("Cache-Control", "no-store")
  async append(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("version") version: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      if (
        !body ||
        Object.keys(body).some(
          (key) =>
            !["requestKey", "grade", "note", "checks", "criteria"].includes(
              key,
            ),
        ) ||
        typeof body.requestKey !== "string" ||
        typeof body.grade !== "string" ||
        typeof body.note !== "string" ||
        !Array.isArray(body.checks) ||
        !Array.isArray(body.criteria)
      )
        throw new BadRequestException("Invalid quality review fields");
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "write");
      return await this.service
        .get()
        .photocraftReviews.append(context.scope, context.userId, {
          projectId,
          sourceVersion: Number(version),
          requestKey: body.requestKey,
          grade: body.grade as QualityGrade,
          note: body.note,
          checks: body.checks as boolean[],
          criteria: body.criteria as string[],
        });
    } catch (error) {
      routeError(error);
    }
  }
}
