import { Controller, Get, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthGuard, Public } from "./common/auth";
import { DatabaseModule } from "./database/database.module";
import { AuthController } from "./auth/auth.controller";
import { FinanceController } from "./finance/finance.controller";
import { MarketController } from "./market/market.controller";
import { CommunityController, NotificationsController } from "./community/community.controller";
import { MessagesModule } from "./messages/messages.module";

@Controller()
export class HealthController {
  @Public()
  @Get("health")
  health() {
    return { status: "ok" };
  }
}

@Module({
  imports: [DatabaseModule, MessagesModule, ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === "test" })],
  controllers: [HealthController, AuthController, FinanceController, MarketController, CommunityController, NotificationsController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
