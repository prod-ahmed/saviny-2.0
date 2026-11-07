/** What may be attached to a message. Anything else is refused before it touches disk. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const VOICE_MAX_MS = 5 * 60 * 1000;

export const ALLOWED_MEDIA: Record<"image" | "voice", string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  voice: ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav"],
};

/** Emoji a user can react with. Anything else is refused. */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export function mediaKindFor(mime: string): "image" | "voice" | null {
  if (ALLOWED_MEDIA.image.includes(mime)) return "image";
  if (ALLOWED_MEDIA.voice.includes(mime)) return "voice";
  return null;
}
