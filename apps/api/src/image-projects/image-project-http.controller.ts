import {
  BadRequestException,
  Body,
  type CanActivate,
  ConflictException,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  ServiceUnavailableException,
  StreamableFile,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import {
  AssetConflictError,
  AssetScopeError,
} from "../assets/asset-foundation.js";
import {
  AccessDeniedError,
  AuthenticationError,
} from "../auth/access-context.js";
import { ImageProjectHttpService } from "./image-project-http.service.js";
import {
  ImageProjectAssetError,
  ImageProjectConflictError,
  ImageProjectValidationError,
} from "./image-project-store.js";
import {
  LocalImageImportConflictError,
  LocalImageImportValidationError,
  type LocalOriginal,
} from "./local-image-import.js";

type RequestHeaders = { headers: { authorization?: string } };
type Upload = {
  fieldname: string;
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

/** Runs before Multer so unauthenticated callers cannot buffer uploaded files. */
@Injectable()
export class ImageProjectHttpGuard implements CanActivate {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<
        RequestHeaders & { method: string; params: { workspaceId?: string } }
      >();
    try {
      await this.service
        .get()
        .access.authorize(
          request.headers.authorization,
          request.params.workspaceId ?? "",
          request.method === "GET" ? "read" : "write",
        );
      return true;
    } catch (error) {
      routeError(error);
    }
  }
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function supportedImage(file: Upload): boolean {
  const bytes = file.buffer;
  if (file.mimetype === "image/png")
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (file.mimetype === "image/jpeg")
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  if (file.mimetype === "image/webp")
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  return false;
}

function routeError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof AuthenticationError) throw new UnauthorizedException();
  if (error instanceof AccessDeniedError || error instanceof AssetScopeError)
    throw new ForbiddenException();
  if (
    error instanceof ImageProjectConflictError ||
    error instanceof LocalImageImportConflictError ||
    error instanceof AssetConflictError
  )
    throw new ConflictException(error.message);
  if (
    error instanceof ImageProjectValidationError ||
    error instanceof ImageProjectAssetError ||
    error instanceof LocalImageImportValidationError
  )
    throw new BadRequestException(error.message);
  if (
    error instanceof Error &&
    (error.message.includes("is required for project HTTP routes") ||
      error.message === "AUTH_JWKS_URL must use HTTPS")
  )
    throw new ServiceUnavailableException("Project API is not configured");
  throw new InternalServerErrorException("Project operation failed");
}

@Controller("workspaces/:workspaceId/image-projects")
@UseGuards(ImageProjectHttpGuard)
export class ImageProjectHttpController {
  constructor(
    @Inject(ImageProjectHttpService)
    private readonly service: ImageProjectHttpService,
  ) {}

  private async authorized(
    request: RequestHeaders,
    workspaceId: string,
    action: "read" | "write",
  ) {
    return await this.service
      .get()
      .access.authorize(request.headers.authorization, workspaceId, action);
  }

  @Get()
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
  ) {
    try {
      const context = await this.authorized(request, workspaceId, "read");
      return await this.service.get().projects.list(context.scope);
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
      const context = await this.authorized(request, workspaceId, "read");
      const project = await this.service
        .get()
        .projects.get(context.scope, projectId);
      if (!project) throw new NotFoundException();
      return project;
    } catch (error) {
      routeError(error);
    }
  }

  @Get(":projectId/assets/:assetId")
  @Header("Cache-Control", "no-store")
  async original(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Param("assetId") assetId: string,
  ) {
    try {
      const context = await this.authorized(request, workspaceId, "read");
      const project = await this.service
        .get()
        .projects.get(context.scope, projectId);
      if (!project) throw new NotFoundException();
      const referenced = project.document.layers.some(
        (layer) =>
          layer.kind === "image" &&
          (layer.assetId === assetId || layer.mask?.assetId === assetId),
      );
      if (!referenced) throw new NotFoundException();
      const original = await this.service
        .get()
        .assets.readOriginal(context.scope, assetId);
      if (!original) throw new NotFoundException();
      return new StreamableFile(original.bytes, {
        type: original.asset.contentType,
        disposition: "attachment",
        length: original.bytes.length,
      });
    } catch (error) {
      routeError(error);
    }
  }

  @Post("imports")
  @Header("Cache-Control", "no-store")
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        files: 50,
        fileSize: 25 * 1024 * 1024,
        fieldSize: 2 * 1024 * 1024,
        fields: 3,
      },
    }),
  )
  async import(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Upload[],
  ) {
    try {
      const context = await this.authorized(request, workspaceId, "write");
      if (
        typeof body.title !== "string" ||
        typeof body.requestKey !== "string" ||
        typeof body.document !== "string" ||
        !Array.isArray(files) ||
        files.length > 50
      )
        throw new BadRequestException("Invalid import fields");
      let document: unknown;
      try {
        document = JSON.parse(body.document);
      } catch {
        throw new BadRequestException("Invalid ImageDocument JSON");
      }
      const originals = new Map<string, LocalOriginal>();
      let totalBytes = 0;
      for (const file of files) {
        if (!UUID.test(file.fieldname) || originals.has(file.fieldname))
          throw new BadRequestException("Invalid or repeated asset field");
        if (!supportedImage(file))
          throw new BadRequestException("Unsupported or invalid image file");
        totalBytes += file.buffer.length;
        if (totalBytes > 100 * 1024 * 1024)
          throw new BadRequestException("Import exceeds total size limit");
        originals.set(file.fieldname, {
          displayName: file.originalname,
          contentType: file.mimetype,
          bytes: file.buffer,
        });
      }
      const result = await this.service
        .get()
        .imports.import(
          context.scope,
          body.title,
          document,
          originals,
          body.requestKey,
        );
      return {
        project: result.project,
        assetIdMap: Object.fromEntries(result.assetIdMap),
      };
    } catch (error) {
      routeError(error);
    }
  }

  @Post(":projectId/assets")
  @Header("Cache-Control", "no-store")
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { files: 1, fileSize: 25 * 1024 * 1024, fields: 1 },
    }),
  )
  async uploadAsset(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Upload[],
  ) {
    try {
      const context = await this.authorized(request, workspaceId, "write");
      if (!(await this.service.get().projects.get(context.scope, projectId)))
        throw new NotFoundException();
      if (
        typeof body.requestKey !== "string" ||
        !Array.isArray(files) ||
        files.length !== 1 ||
        files[0]?.fieldname !== "original" ||
        !supportedImage(files[0])
      )
        throw new BadRequestException("Invalid original upload");
      const file = files[0];
      const asset = await this.service
        .get()
        .assets.createOriginal(context.scope, {
          idempotencyKey: body.requestKey,
          displayName: file.originalname,
          kind: "IMAGE",
          source: "USER_UPLOAD",
          contentType: file.mimetype,
          bytes: file.buffer,
        });
      return { id: asset.id };
    } catch (error) {
      routeError(error);
    }
  }

  @Put(":projectId")
  @Header("Cache-Control", "no-store")
  async save(
    @Req() request: RequestHeaders,
    @Param("workspaceId") workspaceId: string,
    @Param("projectId") projectId: string,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      const context = await this.authorized(request, workspaceId, "write");
      if (
        !body ||
        typeof body.title !== "string" ||
        typeof body.requestKey !== "string" ||
        typeof body.expectedVersion !== "number" ||
        typeof body.document !== "object" ||
        body.document === null ||
        (body.document as { id?: unknown }).id !== projectId
      )
        throw new BadRequestException("Invalid project save fields");
      return await this.service
        .get()
        .projects.save(
          context.scope,
          body.title,
          body.document,
          body.expectedVersion,
          body.requestKey,
        );
    } catch (error) {
      routeError(error);
    }
  }
}
