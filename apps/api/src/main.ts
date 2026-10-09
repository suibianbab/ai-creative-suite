import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.API_PORT ?? 4000);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  app.enableCors({ origin: webOrigin });
  await app.listen(port, "0.0.0.0");
}

void bootstrap();
