import {
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ImageProjectHttpGuard,
  routeError,
} from "./image-project-http.controller.js";
import { ImageProjectHttpService } from "./image-project-http.service.js";

@Controller("workspaces/:workspaceId/photocraft-credits")
@UseGuards(ImageProjectHttpGuard)
export class PhotoCraftCreditHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async balance(
    @Req() request: { headers: { authorization?: string } },
    @Param("workspaceId") workspaceId: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      return {
        available: await this.service
          .get()
          .photocraftJobs.creditBalance(context.scope),
        generationCost: 1,
      };
    } catch (error) {
      routeError(error);
    }
  }
}
