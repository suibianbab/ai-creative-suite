import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
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
import type { PhotoCraftJobOperation } from "./photocraft-edit-jobs.js";

type RequestHeaders = { headers: { authorization?: string } };

@Controller("workspaces/:workspaceId/photocraft-projects/:projectId/jobs")
@UseGuards(ImageProjectHttpGuard)
export class PhotoCraftEditJobHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      if (
        typeof body?.requestKey !== "string" ||
        typeof body.operation !== "string" ||
        typeof body.expectedVersion !== "number" ||
        Object.keys(body).some(
          (key) =>
            !["requestKey", "operation", "expectedVersion", "params"].includes(
              key,
            ),
        )
      )
        throw new BadRequestException("Invalid PhotoCraft job request");
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "write");
      return await this.service.get().photocraftJobs.enqueue(context.scope, {
        projectId,
        requestKey: body.requestKey,
        operation: body.operation as PhotoCraftJobOperation,
        params: body.params,
        expectedVersion: body.expectedVersion,
      });
    } catch (error) {
      routeError(error);
    }
  }

  @Get(":jobId")
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("jobId") jobId: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      const job = await this.service
        .get()
        .photocraftJobs.get(context.scope, projectId, jobId);
      if (!job) throw new NotFoundException();
      return job;
    } catch (error) {
      routeError(error);
    }
  }
}
