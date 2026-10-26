import { z } from "zod";
import { HttpError } from "../common/errors";
import { MESSAGE_MAX_LENGTH, listConversations, listMessages, markRead, mediaContent, startFromListing, uploadMedia } from "../messages/service";
import { MEDIA_MAX_BYTES } from "../messages/media.rules";
import { route, type Route } from "../http/types";

const sendMessageSchema = z.object({
  kind: z.enum(["text", "image", "voice"]).optional(),
  body: z.string().max(MESSAGE_MAX_LENGTH).optional(),
  mediaId: z.string().min(1).optional(),
  durationMs: z.number().optional(),
}).strict();

export const messagesRoutes: Route[] = [
  /** Start a conversation about a listing (or add to one) over REST. Live sending goes through the socket. */
  route("POST", "listings/:id/messages", async (ctx) => {
    const dto = await ctx.body(sendMessageSchema);
    return startFromListing(ctx.user.id, ctx.params.id, dto);
  }),

  route("GET", "conversations", (ctx) => listConversations(ctx.user.id)),

  route("GET", "conversations/:id/messages", (ctx) => {
    const limit = ctx.query.get("limit");
    return listMessages(ctx.user.id, ctx.params.id, ctx.query.get("before") ?? undefined, limit ? Number(limit) : undefined);
  }),

  route("POST", "conversations/:id/read", (ctx) => markRead(ctx.user.id, ctx.params.id)),

  /** Photo or voice note upload. The message is sent afterwards over the socket with the returned mediaId. */
  route("POST", "conversations/:id/media", async (ctx) => {
    const form = await ctx.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file to send");
    if (file.size > MEDIA_MAX_BYTES) throw new HttpError(413, "File is larger than 10 MB");
    const buffer = Buffer.from(await file.arrayBuffer());
    return uploadMedia(ctx.user.id, ctx.params.id, { buffer, mimetype: file.type, size: file.size });
  }),

  /** Streams a photo or voice note to a participant. The browser fetches it with the session token. */
  route("GET", "media/:id", async (ctx) => {
    const file = await mediaContent(ctx.user.id, ctx.params.id);
    return new Response(new Uint8Array(file.body), {
      headers: { "Content-Type": file.mime, "Cache-Control": "private, max-age=3600", "Content-Length": String(file.body.length) },
    });
  }),

];
