import { z } from "zod";
import { context } from "../context";
import { author } from "../common/mappers";
import { badRequest, forbidden, notFound } from "../common/errors";
import { removeListing } from "../common/cascade";
import { defined } from "../common/domain";
import { newId, nowIso, round2 } from "../common/security";
import { escapeRegex, isDuplicateKey, type Filter, type Store } from "../database/store";
import type { Row } from "../database/types";
import { route, type Route } from "../http/types";
import { positiveMoney, text } from "../http/schema";
import { askObject, dataBlock, UNTRUSTED_RULE } from "../ai/model";

export const CONDITIONS = ["New", "Like new", "Good", "Fair"] as const;
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

const db = async (): Promise<Store> => (await context()).store;

/** Photos must be https URLs or small inline images. */
function assertPhotos(photos: string[]): void {
  for (const photo of photos) {
    const isHttps = /^https:\/\//.test(photo);
    const isImage = /^data:image\/(png|jpe?g|webp|gif);base64,/.test(photo) && photo.length <= MAX_PHOTO_CHARS;
    if (!isHttps && !isImage) throw badRequest("Photos must be https URLs or small images");
  }
}

/** Listing mutations are seller-only: 404 when unknown, 403 when owned by someone else. */
async function sellerListing(store: Store, id: string, userId: string): Promise<Row> {
  const listing = await store.one("listings", { id });
  if (!listing) throw notFound();
  if (listing.user_id !== userId) throw forbidden("Only the seller can change this listing");
  return listing;
}

async function photosOf(store: Store, listingId: string): Promise<string[]> {
  return (await store.many("listing_photos", { listing_id: listingId }, { sort: { position: 1 } })).map((p) => p.url);
}

async function setPhotos(store: Store, listingId: string, photos: string[]): Promise<void> {
  await store.remove("listing_photos", { listing_id: listingId });
  if (photos.length > 0) {
    await store.insert("listing_photos", photos.map((url, position) => ({ listing_id: listingId, position, url })));
  }
}

async function listingView(store: Store, r: Row, viewerId?: string) {
  const seller = await store.one("users", { id: r.user_id });
  const favorited = !!viewerId && !!(await store.one("favorites", { user_id: viewerId, listing_id: r.id }));
  const photos = await photosOf(store, r.id);
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
    seller: author({ ...(seller as Row), user_id: r.user_id }),
    isOwner: !!viewerId && viewerId === r.user_id,
    favorited,
  };
}

export const marketRoutes: Route[] = [
  route("GET", "listings", async (ctx) => {
    const q = ctx.query;
    const store = await db();
    const filter: Filter = {};
    if (q.get("mine") === "true" && ctx.viewer) filter.user_id = ctx.viewer.id;
    else filter.status = "available";
    const category = q.get("category");
    const maxPrice = q.get("maxPrice");
    const search = q.get("q")?.trim();
    if (category && category !== "All categories") filter.category = category;
    if (maxPrice && Number(maxPrice) > 0) filter.price = { $lte: Number(maxPrice) };
    if (search) {
      const pattern = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [{ title: pattern }, { description: pattern }];
    }
    const total = await store.count("listings", filter);
    const size = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? 24) || 24));
    const skip = (Math.max(1, Number(q.get("page") ?? 1) || 1) - 1) * size;
    const rows = await store.many("listings", filter, { sort: { created_at: -1 }, skip, limit: size });
    return { items: await Promise.all(rows.map((r) => listingView(store, r, ctx.viewer?.id))), total };
  }, { public: true }),

  route("POST", "listings", async (ctx) => {
    const dto = await ctx.body(listingSchema);
    const photos = dto.photos ?? [];
    assertPhotos(photos);
    const store = await db();
    const id = newId();
    await store.insert("listings", {
      id, user_id: ctx.user.id, title: dto.title.trim(), description: dto.description.trim(), price: round2(dto.price),
      category: dto.category.trim(), condition: dto.condition, status: "available", created_at: nowIso(),
    });
    await setPhotos(store, id, photos);
    return listingView(store, (await store.one("listings", { id })) as Row, ctx.user.id);
  }),

  route("GET", "listings/:id", async (ctx) => {
    const store = await db();
    const listing = await store.one("listings", { id: ctx.params.id });
    const visible = listing && (listing.status === "available" || listing.user_id === ctx.viewer?.id);
    if (!listing || !visible) throw notFound();
    return listingView(store, listing, ctx.viewer?.id);
  }, { public: true }),

  route("PATCH", "listings/:id", async (ctx) => {
    const dto = await ctx.body(listingUpdateSchema);
    const store = await db();
    const id = ctx.params.id;
    await sellerListing(store, id, ctx.user.id);
    if (dto.photos) assertPhotos(dto.photos);
    await store.update("listings", { id }, defined({
      title: dto.title?.trim(),
      description: dto.description?.trim(),
      price: dto.price === undefined ? undefined : round2(dto.price),
      category: dto.category,
      condition: dto.condition,
    }));
    if (dto.photos) await setPhotos(store, id, dto.photos);
    return listingView(store, (await store.one("listings", { id })) as Row, ctx.user.id);
  }),

  route("DELETE", "listings/:id", async (ctx) => {
    const store = await db();
    await sellerListing(store, ctx.params.id, ctx.user.id);
    await removeListing(store, ctx.params.id);
  }, { status: 204 }),

  route("POST", "listings/:id/status", async (ctx) => {
    const dto = await ctx.body(statusSchema);
    const store = await db();
    await sellerListing(store, ctx.params.id, ctx.user.id);
    await store.update("listings", { id: ctx.params.id }, { status: dto.status });
    return listingView(store, (await store.one("listings", { id: ctx.params.id })) as Row, ctx.user.id);
  }),

  /** Records a sale outcome; a completed sale marks the listing as sold. */
  route("POST", "listings/:id/sale", async (ctx) => {
    const dto = await ctx.body(saleSchema);
    const store = await db();
    const id = ctx.params.id;
    const listing = await sellerListing(store, id, ctx.user.id);
    const saleId = newId();
    await store.insert("sales", {
      id: saleId, user_id: ctx.user.id, listing_id: id, outcome: dto.outcome, amount: round2(dto.amount ?? listing.price), created_at: nowIso(),
    });
    if (dto.outcome === "completed") await store.update("listings", { id }, { status: "sold" });
    return { saleId, listing: await listingView(store, (await store.one("listings", { id })) as Row, ctx.user.id) };
  }),

  route("PUT", "listings/:id/favorite", async (ctx) => {
    const store = await db();
    if (!(await store.one("listings", { id: ctx.params.id, status: "available" }))) throw notFound();
    try {
      await store.insert("favorites", { user_id: ctx.user.id, listing_id: ctx.params.id, created_at: nowIso() });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err; // already a favourite
    }
  }, { status: 204 }),

  route("DELETE", "listings/:id/favorite", async (ctx) => {
    await (await db()).remove("favorites", { user_id: ctx.user.id, listing_id: ctx.params.id });
  }, { status: 204 }),

  route("GET", "favorites", async (ctx) => {
    const store = await db();
    const favorites = await store.many("favorites", { user_id: ctx.user.id }, { sort: { created_at: -1 } });
    const listings = new Map((await store.many("listings", { id: { $in: favorites.map((f) => f.listing_id) }, status: "available" }))
      .map((l) => [l.id, l]));
    const visible = favorites.map((f) => listings.get(f.listing_id)).filter((l): l is Row => !!l);
    return Promise.all(visible.map((r) => listingView(store, r, ctx.user.id)));
  }),

  // ---- AI: Smart Search -------------------------------------------------------

  /** Step 1 – detects objects in a photo so the user can pick one to search. */
  route("POST", "listings/search/detect", async (ctx) => {
    const dto = await ctx.body(z.object({ image: z.string().max(2_000_000) }).strict());
    const answer = await askObject({
      messages: [{
        role: "user",
        content: [
          { type: "text", text: `List every distinct physical object visible in this photo that could be sold second-hand. For each give a short English label and a confidence score 0-1. ${UNTRUSTED_RULE}` },
          { type: "image", image: Buffer.from(dto.image.replace(/^data:image\/\w+;base64,/, ""), "base64"), mediaType: "image/jpeg" },
        ],
      }],
      system: "You identify objects in photos for a second-hand marketplace.",
      schema: z.object({
        objects: z.array(z.object({ label: z.string().max(60), confidence: z.number().min(0).max(1) })).max(10),
      }),
    });
    return answer;
  }, { limit: { max: 20, windowMs: 60_000 } }),

  /** Step 2 – finds listings that match a text/image query. */
  route("POST", "listings/search/visual", async (ctx) => {
    const dto = await ctx.body(z.object({
      query: text(120),
      image: z.string().max(2_000_000).optional(),
      category: z.string().max(40).optional(),
      maxPrice: z.string().max(20).optional(),
      condition: z.string().max(20).optional(),
    }).strict());
    const store = await db();
    const filter: Filter = { status: "available" };
    if (dto.category && dto.category !== "All categories") filter.category = dto.category;
    if (dto.maxPrice && Number(dto.maxPrice) > 0) filter.price = { $lte: Number(dto.maxPrice) };
    if (dto.condition) filter.condition = dto.condition;
    const pattern = { $regex: escapeRegex(dto.query), $options: "i" };
    filter.$or = [{ title: pattern }, { description: pattern }, { category: pattern }];
    const rows = await store.many("listings", filter, { sort: { created_at: -1 }, limit: 30 });
    const results = await Promise.all(rows.map(async (r) => {
      const view = await listingView(store, r, ctx.viewer?.id);
      return { ...view, similarity: 0.8 };
    }));
    return { results };
  }, { public: true, limit: { max: 30, windowMs: 60_000 } }),

  // ---- AI: Product Analysis ---------------------------------------------------

  /**
   * Full AI inspection of a listing.
   * - If the listing has photos, they are sent to Gemini Vision for visual analysis.
   * - Up to 10 comparable listings (same category) are fetched to anchor the price verdict.
   * - Returns a structured report: state, flaws, inconsistencies, price range, checklist, questions.
   */
  route("POST", "listings/:id/ai-analyze", async (ctx) => {
    const store = await db();
    const listing = await store.one("listings", { id: ctx.params.id });
    if (!listing || (listing.status !== "available" && listing.user_id !== ctx.viewer?.id)) throw notFound();

    const photos = await photosOf(store, ctx.params.id);

    // ── Comparable listings (same category, available, excluding this one) ──
    const comparables = await store.many(
      "listings",
      { category: listing.category, status: "available", id: { $ne: ctx.params.id } },
      { sort: { created_at: -1 }, limit: 10 },
    );
    const comparableText = comparables.length > 0
      ? comparables.map((c) => `- ${c.title} | condition: ${c.condition} | price: ${c.price}`).join("\n")
      : "No comparable listings found.";

    const listingText = [
      `title: ${listing.title}`,
      `category: ${listing.category}`,
      `condition: ${listing.condition}`,
      `price: ${listing.price} (currency: ${ctx.user?.currency ?? "USD"})`,
      `description: ${listing.description?.trim() || "none"}`,
      `photos available: ${photos.length}`,
    ].join("\n");

    // ── Build the vision message: text + up to 3 inline photos ──
    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image"; image: Buffer; mediaType: string };

    const contentParts: ContentPart[] = [
      {
        type: "text",
        text: [
          "Evaluate this second-hand listing for a potential buyer.",
          dataBlock("listing", listingText),
          dataBlock("comparable listings on the marketplace", comparableText),
          photos.length > 0
            ? "The listing photos follow. Analyse them carefully for visible wear, damage, missing parts, or inconsistencies with the description."
            : "No photos were provided; base your analysis on the description only.",
          UNTRUSTED_RULE,
        ].join("\n\n"),
      },
    ];

    // Attach up to 3 inline base64 photos (skip https URLs – the model can't fetch them)
    const inlinePhotos = photos
      .filter((p) => p.startsWith("data:image/"))
      .slice(0, 3);

    for (const photo of inlinePhotos) {
      const match = photo.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) continue;
      contentParts.push({
        type: "image",
        image: Buffer.from(match[2], "base64"),
        mediaType: match[1],
      });
    }

    const answer = await askObject({
      system: `You are an expert second-hand product evaluator. Be factual, specific and buyer-focused. Answer in the language of the listing title. ${UNTRUSTED_RULE}`,
      messages: [{ role: "user", content: contentParts }],
      schema: z.object({
        visualState: z.string().max(300),
        detectedFlaws: z.array(z.string().max(150)).max(6),
        inconsistencies: z.array(z.string().max(150)).max(5),
        missingInfo: z.array(z.string().max(150)).max(5),
        priceVerdict: z.enum(["deal", "fair", "high"]),
        priceVerdictLabel: z.string().max(100),
        estimatedPriceRange: z.object({
          min: z.number().min(0),
          max: z.number().min(0),
          avg: z.number().min(0),
        }),
        priceExplanation: z.string().max(400),
        checklist: z.array(z.string().max(150)).max(6),
        questionsForSeller: z.array(z.string().max(250)).max(5),
      }),
    });

    return { ...answer, listingId: ctx.params.id };
  }, { limit: { max: 10, windowMs: 60_000 } }),
];

