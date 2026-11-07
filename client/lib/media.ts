import { apiBlob } from "./api";

/** Blob URLs for photos and voice notes, fetched once per file with the session token. */
const cache = new Map<string, Promise<string>>();

export function mediaUrl(id: string): Promise<string> {
  let url = cache.get(id);
  if (!url) {
    url = apiBlob(`/media/${id}`).then((blob) => URL.createObjectURL(blob));
    cache.set(id, url);
    url.catch(() => cache.delete(id));
  }
  return url;
}
