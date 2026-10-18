import { z } from "zod";
import { context } from "../context";
import { author } from "../common/mappers";
import { badRequest, forbidden, notFound } from "../common/errors";
import { newId, nowIso, round2 } from "../common/security";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { positiveMoney, text } from "../http/schema";

const CONDITIONS = ["New", "Like new", "Good", "Fair"] as const;
const MAX_PHOTO_CHARS = Math.ceil(500 * 1024 * 1.4); // ~500 KB once base64-encoded
const MAX_PHOTOS = 5;

const photoList = z.array(z.string()).max(MAX_PHOTOS).optional();

const listingSchema = z.object({
  title: text(80),
  description: text(2000),
  price: positiveMoney,
  category: text(40),
  condition: z.enum(CONDITIONS),
  photos: photoList,
}).strict();

const listingUpdateSchema = z.object({
  title: text(80).optional(),
  description: z.string().max(2000).optional(),
  price: positiveMoney.optional(),
  category: z.string().max(40).optional(),
  condition: z.enum(CONDITIONS).optional(),
  photos: photoList,
}).strict();

const statusSchema = z.object({ status: z.enum(["available", "unavailable", "sold"]) }).strict();

const saleSchema = z.object({
  outcome: z.enum(["completed", "cancelled"]),
  amount: positiveMoney.optional(),
}).strict();

const db = () => context().db;

/** Photos must be https URLs or small inline images. */
function assertPhotos(photos: string[]): void {
  for (const photo of photos) {
    const isHttps = /^https:\/\//.test(photo);
    const isImage = /^data:image\/(png|jpe?g|webp|gif);base64,/.test(photo) && photo.length <= MAX_PHOTO_CHARS;
    if (!isHttps && !isImage) throw badRequest("Photos must be https URLs or small images");
  }
}

/** Listing mutations are seller-only: 404 when unknown, 403 when owned by someone else. */
function sellerListing(id: string, userId: string): Row {
  const listing = db().prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row | undefined;
  if (!listing) throw notFound();
  if (listing.user_id !== userId) throw forbidden("Only the seller can change this listing");
  return listing;
}

function photosOf(listingId: string): string[] {
  return (db().prepare("SELECT url FROM listing_photos WHERE listing_id = ? ORDER BY position").all(listingId) as { url: string }[])
    .map((p) => p.url);
}

function setPhotos(listingId: string, photos: string[]): void {
  db().prepare("DELETE FROM listing_photos WHERE listing_id = ?").run(listingId);
  photos.forEach((url, position) => {
    db().prepare("INSERT INTO listing_photos (listing_id, position, url) VALUES (?, ?, ?)").run(listingId, position, url);
  });
}

function listingView(r: Row, viewerId?: string) {
  const seller = db().prepare("SELECT first_name, last_name, id FROM users WHERE id = ?").get(r.user_id) as Row;
  const favorited = !!viewerId && !!db().prepare("SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?").get(viewerId, r.id);
  const photos = photosOf(r.id);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    price: r.price,
    category: r.category,
    condition: r.condition,
    photos,
    image: photos[0] ?? "",
    status: r.status,
    createdAt: r.created_at,
    seller: author({ ...seller, user_id: seller.id }),
    isOwner: !!viewerId && viewerId === r.user_id,
    favorited,
  };
}

const reload = (id: string): Row => db().prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row;

export const marketRoutes: Route[] = [
  route("GET", "listings", (ctx) => {
    const q = ctx.query;
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.get("mine") === "true" && ctx.viewer) {
      where.push("user_id = ?");
      params.push(ctx.viewer.id);
    } else {
      where.push("status = 'available'");
    }
    const category = q.get("category");
    const maxPrice = q.get("maxPrice");
    const search = q.get("q")?.trim();
    if (category && category !== "All categories") { where.push("category = ?"); params.push(category); }
    if (maxPrice && Number(maxPrice) > 0) { where.push("price <= ?"); params.push(Number(maxPrice)); }
    if (search) {
      where.push("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)");
      const term = `%${search.toLowerCase()}%`;
      params.push(term, term);
    }
    const clause = where.join(" AND ");
    const total = (db().prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${clause}`).get(...params) as { n: number }).n;
    const size = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? 24) || 24));
    const offset = (Math.max(1, Number(q.get("page") ?? 1) || 1) - 1) * size;
    const rows = db().prepare(`SELECT * FROM listings WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, size, offset) as Row[];
    return { items: rows.map((r) => listingView(r, ctx.viewer?.id)), total };
  }, { public: true }),

  route("POST", "listings", async (ctx) => {
    const dto = await ctx.body(listingSchema);
    const photos = dto.photos ?? [];
    assertPhotos(photos);
    const id = newId();
    db().transaction(() => {
      db().prepare(`INSERT INTO listings (id, user_id, title, description, price, category, condition, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?)`)
        .run(id, ctx.user.id, dto.title.trim(), dto.description.trim(), round2(dto.price), dto.category.trim(), dto.condition, nowIso());
      setPhotos(id, photos);
    })();
    return listingView(reload(id), ctx.user.id);
  }),

  route("GET", "listings/:id", (ctx) => {
    const listing = db().prepare("SELECT * FROM listings WHERE id = ?").get(ctx.params.id) as Row | undefined;
    const visible = listing && (listing.status === "available" || listing.user_id === ctx.viewer?.id);
    if (!listing || !visible) throw notFound();
    return listingView(listing, ctx.viewer?.id);
  }, { public: true }),

  route("PATCH", "listings/:id", async (ctx) => {
    const dto = await ctx.body(listingUpdateSchema);
    const id = ctx.params.id;
    sellerListing(id, ctx.user.id);
    if (dto.photos) assertPhotos(dto.photos);
    db().transaction(() => {
      db().prepare(`UPDATE listings SET title = COALESCE(?, title), description = COALESCE(?, description),
          price = COALESCE(?, price), category = COALESCE(?, category), condition = COALESCE(?, condition) WHERE id = ?`)
        .run(dto.title?.trim() ?? null, dto.description?.trim() ?? null, dto.price === undefined ? null : round2(dto.price),
          dto.category ?? null, dto.condition ?? null, id);
      if (dto.photos) setPhotos(id, dto.photos);
    })();
    return listingView(reload(id), ctx.user.id);
  }),

  route("DELETE", "listings/:id", (ctx) => {
    sellerListing(ctx.params.id, ctx.user.id);
    db().prepare("DELETE FROM listings WHERE id = ?").run(ctx.params.id);
  }, { status: 204 }),

  route("POST", "listings/:id/status", async (ctx) => {
    const dto = await ctx.body(statusSchema);
    sellerListing(ctx.params.id, ctx.user.id);
    db().prepare("UPDATE listings SET status = ? WHERE id = ?").run(dto.status, ctx.params.id);
    return listingView(reload(ctx.params.id), ctx.user.id);
  }),

  /** Records a sale outcome; a completed sale marks the listing as sold. */
  route("POST", "listings/:id/sale", async (ctx) => {
    const dto = await ctx.body(saleSchema);
    const id = ctx.params.id;
    const listing = sellerListing(id, ctx.user.id);
    const saleId = newId();
    db().transaction(() => {
      db().prepare("INSERT INTO sales (id, user_id, listing_id, outcome, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(saleId, ctx.user.id, id, dto.outcome, round2(dto.amount ?? listing.price), nowIso());
      if (dto.outcome === "completed") db().prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(id);
    })();
    return { saleId, listing: listingView(reload(id), ctx.user.id) };
  }),

  route("PUT", "listings/:id/favorite", (ctx) => {
    const listing = db().prepare("SELECT 1 FROM listings WHERE id = ? AND status = 'available'").get(ctx.params.id);
    if (!listing) throw notFound();
    db().prepare("INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)").run(ctx.user.id, ctx.params.id, nowIso());
  }, { status: 204 }),

  route("DELETE", "listings/:id/favorite", (ctx) => {
    db().prepare("DELETE FROM favorites WHERE user_id = ? AND listing_id = ?").run(ctx.user.id, ctx.params.id);
  }, { status: 204 }),

  route("GET", "favorites", (ctx) => {
    const rows = db().prepare(`
      SELECT l.* FROM favorites f JOIN listings l ON l.id = f.listing_id
      WHERE f.user_id = ? AND l.status = 'available' ORDER BY f.created_at DESC`).all(ctx.user.id) as Row[];
    return rows.map((r) => listingView(r, ctx.user.id));
  }),
];

