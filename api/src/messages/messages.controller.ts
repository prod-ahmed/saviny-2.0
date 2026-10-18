import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { CurrentUser } from "../common/auth";
import { MESSAGE_MAX_LENGTH, MessagesService } from "./messages.service";
import { MEDIA_MAX_BYTES } from "./media.rules";

class SendMessageDto {
  @IsOptional() @IsIn(["text", "image", "voice"]) kind?: "text" | "image" | "voice";
  @IsOptional() @IsString() @MaxLength(MESSAGE_MAX_LENGTH) body?: string;
  @IsOptional() @IsString() @IsNotEmpty() mediaId?: string;
  @IsOptional() @IsNumber() durationMs?: number;
}

/** REST side of messaging: start a conversation, read history, upload media, mark as read, stream media. Live sending goes through the socket. */
@Controller()
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post("listings/:id/messages")
  start(@CurrentUser() user: { id: string }, @Param("id") id: string, @Body() dto: SendMessageDto) {
    return this.messages.startFromListing(user, id, dto);
  }

  @Get("conversations")
  list(@CurrentUser() user: { id: string }) {
    return this.messages.listConversations(user);
  }

  @Get("conversations/:id/messages")
  history(@CurrentUser() user: { id: string }, @Param("id") id: string, @Query("before") before?: string, @Query("limit") limit?: string) {
    return this.messages.listMessages(user, id, before, limit ? Number(limit) : undefined);
  }

  @Post("conversations/:id/read")
  read(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    return this.messages.markRead(user.id, id);
  }

  /** Photo or voice note upload. The message is sent afterwards over the socket with the returned mediaId. */
  @Post("conversations/:id/media")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MEDIA_MAX_BYTES } }))
  async upload(
    @CurrentUser() user: { id: string },
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException("Choose a file to send");
    return this.messages.uploadMedia(user.id, id, file);
  }

  /** Streams a photo or voice note to a participant. The browser fetches it with the session token. */
  @Get("media/:id")
  media(@CurrentUser() user: { id: string }, @Param("id") id: string, @Res() res: Response) {
    const file = this.messages.mediaFile(user.id, id);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.type(file.mime);
    res.sendFile(file.path);
  }
}
