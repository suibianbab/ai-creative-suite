import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.API_PORT ?? 4000);
  const host = process.env.API_HOST ?? "127.0.0.1";
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  app.enableCors({ origin: webOrigin });
  app.useBodyParser("json", { limit: "2mb" });
  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
