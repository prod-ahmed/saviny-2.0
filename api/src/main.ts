import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Saviny listening on http://localhost:${port} (API: /api)`);
}

bootstrap();
