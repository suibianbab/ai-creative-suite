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
  Put,
  Req,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import {
  ImageProjectHttpGuard,
  routeError,
} from "./image-project-http.controller.js";
import { ImageProjectHttpService } from "./image-project-http.service.js";

type RequestHeaders = { headers: { authorization?: string } };
type Upload = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};
type Files = { source?: Upload[]; original?: Upload[] };
const upload = FileFieldsInterceptor(
  [
    { name: "source", maxCount: 1 },
    { name: "original", maxCount: 1 },
  ],
  {
    limits: {
      files: 2,
      fileSize: 25 * 1024 * 1024,
      fields: 4,
      fieldSize: 1024,
    },
  },
);

function supportedOriginal(file: Upload): boolean {
  const bytes = file.buffer;
  if (file.mimetype === "image/png")
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === "image/webp")
    return (
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  return false;
}

@Controller("workspaces/:workspaceId/photocraft-projects")
@UseGuards(ImageProjectHttpGuard)
export class PhotoCraftProjectHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      return await this.service.get().photocraftProjects.list(context.scope);
    } catch (error) {
      routeError(error);
    }
  }

  @Get(":projectId")
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      const project = await this.service
        .get()
        .photocraftProjects.get(context.scope, projectId);
      if (!project) throw new NotFoundException();
      return project;
    } catch (error) {
      routeError(error);
    }
  }

  @Get(":projectId/source")
  @Header("Cache-Control", "no-store")
  async source(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "read");
      const bytes = await this.service
        .get()
        .photocraftProjects.readSource(context.scope, projectId);
      if (!bytes) throw new NotFoundException();
      return new StreamableFile(bytes, {
        type: "application/x-photocraft",
        disposition: `attachment; filename="${projectId}.pcraft"`,
        length: bytes.length,
      });
    } catch (error) {
      routeError(error);
    }
  }

  @Post()
  @Header("Cache-Control", "no-store")
  @UseInterceptors(upload)
  async create(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Files,
  ) {
    return await this.save(request, workspaceId, undefined, body, files);
  }

  @Put(":projectId")
  @Header("Cache-Control", "no-store")
  @UseInterceptors(upload)
  async update(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Files,
  ) {
    return await this.save(request, workspaceId, projectId, body, files);
  }

  private async save(
    request: RequestHeaders,
    workspaceId: string,
    projectId: string | undefined,
    body: Record<string, unknown>,
    files: Files,
  ) {
    try {
      const context = await this.service
        .get()
        .access.authorize(request.headers.authorization, workspaceId, "write");
      const source = files?.source?.[0];
      const original = files?.original?.[0];
      if (
        !source ||
        source.mimetype !== "application/x-photocraft" ||
        typeof body?.id !== "string" ||
        (projectId && projectId !== body.id) ||
        typeof body.title !== "string" ||
        typeof body.requestKey !== "string" ||
        typeof body.expectedVersion !== "string" ||
        (original && !supportedOriginal(original))
      )
        throw new BadRequestException("Invalid PhotoCraft project upload");
      return await this.service.get().photocraftProjects.save(context.scope, {
        id: body.id,
        title: body.title,
        requestKey: body.requestKey,
        expectedVersion: Number(body.expectedVersion),
        bytes: source.buffer,
        ...(original
          ? {
              original: {
                bytes: original.buffer,
                contentType: original.mimetype,
                name: original.originalname,
              },
            }
          : {}),
      });
    } catch (error) {
      routeError(error);
    }
  }
}
