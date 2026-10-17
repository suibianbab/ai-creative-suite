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
import { sampleBatchJobIds } from "./photocraft-edit-jobs.js";

type RequestHeaders = { headers: { authorization?: string } };

// R1（codex 第二轮复审）：单图确认环通过时登记的服务端确认快照。批量入队
// 只能引用这里落库的不可变记录——直接提交任意 steps+source 不再被认作
// 「已确认配方」。确认人与时间取自登录上下文与服务端时钟。
@Controller("workspaces/:workspaceId/photocraft-batch-confirmations")
@UseGuards(ImageProjectHttpGuard)
export class PhotoCraftBatchConfirmationHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      if (
        Object.keys(body ?? {}).some(
          (key) => !["source", "steps"].includes(key),
        )
      )
        throw new BadRequestException("Invalid PhotoCraft confirmation");
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "write");
      return await this.service
        .get()
        .photocraftJobs.confirmBatchRecipe(context.scope, context.userId, {
          source: body?.source,
          steps: body?.steps,
        });
    } catch (error) {
      routeError(error);
    }
  }

  @Get(":id")
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("id") id: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      const confirmation = await this.service
        .get()
        .photocraftJobs.batchConfirmationById(context.scope, id);
      if (!confirmation) throw new NotFoundException();
      return confirmation;
    } catch (error) {
      routeError(error);
    }
  }
}

// M4 批量配方（方案 §12.3）：一张图上经确认环通过的动作列表一键套到整个目录。
// POST 入队（按张计费、整批额度预检；R1 后必须携带单图确认快照的
// confirmationId——配方与来源以该不可变记录为准，入队时校验其仍有效），
// GET 按 requestKey 查询批量状态、抽样复检清单与来源/确认快照。
@Controller("workspaces/:workspaceId/photocraft-batch-recipes")
@UseGuards(ImageProjectHttpGuard)
export class PhotoCraftBatchRecipeHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      if (
        typeof body?.requestKey !== "string" ||
        !Array.isArray(body.projectIds) ||
        Object.keys(body).some(
          (key) =>
            !["requestKey", "projectIds", "confirmationId"].includes(key),
        )
      )
        throw new BadRequestException("Invalid PhotoCraft batch request");
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "write");
      return await this.service
        .get()
        .photocraftJobs.enqueueBatch(context.scope, {
          requestKey: body.requestKey,
          projectIds: body.projectIds,
          confirmationId: body.confirmationId,
        });
    } catch (error) {
      routeError(error);
    }
  }

  @Get(":requestKey")
  @Header("Cache-Control", "no-store")
  async status(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("requestKey") requestKey: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      const jobs = await this.service
        .get()
        .photocraftJobs.listByRequestKey(context.scope, requestKey);
      if (jobs.length === 0) throw new NotFoundException();
      const sampled = sampleBatchJobIds(jobs.map((job) => job.id));
      return {
        requestKey,
        total: jobs.length,
        statuses: jobs.reduce<Record<string, number>>((counts, job) => {
          counts[job.status] = (counts[job.status] ?? 0) + 1;
          return counts;
        }, {}),
        sampledJobIds: sampled,
        // 来源快照（P2-2）：0015 之前的批次无来源记录时为 null。
        source:
          (await this.service
            .get()
            .photocraftJobs.batchRequestByRequestKey(
              context.scope,
              requestKey,
            )) ?? null,
        jobs,
      };
    } catch (error) {
      routeError(error);
    }
  }
}
