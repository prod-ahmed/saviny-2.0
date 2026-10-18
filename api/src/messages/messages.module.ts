import { Module } from "@nestjs/common";
import { MessageHub } from "./message.hub";
import { MessagesController } from "./messages.controller";
import { MessagesGateway } from "./messages.gateway";
import { MessagesService } from "./messages.service";

@Module({
  controllers: [MessagesController],
  providers: [MessageHub, MessagesService, MessagesGateway],
})
export class MessagesModule {}
