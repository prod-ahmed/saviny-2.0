import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Put, Query,
} from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";
import { CurrentUser, Public } from "../common/auth";
import { author } from "../common/mappers";
import { notify, owned } from "../common/domain";
import { newId, nowIso, round2 } from "../common/security";
import { DatabaseService } from "../database/database.module";
import { Row } from "../database/types";

const CONDITIONS = ["New", "Like new", "Good", "Fair"];
const MAX_PHOTO_CHARS = Math.ceil(500 * 1024 * 1.4); // ~500 KB once base64-encoded

class ListingDto {
  @IsString() @IsNotEmpty() @MaxLength(80) title!: string;
  @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() price!: number;
  @IsString() @IsNotEmpty() @MaxLength(40) category!: string;
  @IsIn(CONDITIONS) condition!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) photos?: string[];
}

class ListingUpdateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() price?: number;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsIn(CONDITIONS) condition?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) photos?: string[];
}

class StatusDto {
  @IsIn(["available", "unavailable", "sold"]) status!: string;
}

class SaleDto {
  @IsIn(["completed", "cancelled"]) outcome!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount?: number;
}

class MessageDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) body!: string;
}

/** Photos must be https URLs or small inline images. */
function assertPhotos(photos: string[]): void {
  for (const photo of photos) {
    const isHttps = /^https:\/\//.test(photo);
    const isImage = /^data:image\/(png|jpe?g|webp|gif);base64,/.test(photo) && photo.length <= MAX_PHOTO_CHARS;
    if (!isHttps && !isImage) throw new BadRequestException("Photos must be https URLs or small images");
  }
}

@Controller()
export class MarketController {
  constructor(private readonly database: DatabaseService) {}

  private get db() {
    return this.database.db;
  }

  /** Listing mutations are seller-only: 404 when unknown, 403 when owned by someone else. */
  private sellerListing(id: string, userId: string): Row {
    const listing = this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row | undefined;
    if (!listing) throw new NotFoundException();
    if (listing.user_id !== userId) throw new ForbiddenException("Only the seller can change this listing");
    return listing;
  }

  private photos(listingId: string): string[] {
    return (this.db.prepare("SELECT url FROM listing_photos WHERE listing_id = ? ORDER BY position").all(listingId) as { url: string }[])
      .map((p) => p.url);
  }

  private setPhotos(listingId: string, photos: string[]) {
    this.db.prepare("DELETE FROM listing_photos WHERE listing_id = ?").run(listingId);
    photos.forEach((url, position) => {
      this.db.prepare("INSERT INTO listing_photos (listing_id, position, url) VALUES (?, ?, ?)").run(listingId, position, url);
    });
  }

  private view(r: Row, viewerId?: string) {
    const seller = this.db.prepare("SELECT first_name, last_name, id FROM users WHERE id = ?").get(r.user_id) as Row;
    const favorited = !!viewerId && !!this.db.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?").get(viewerId, r.id);
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      price: r.price,
      category: r.category,
      condition: r.condition,
      photos: this.photos(r.id),
      image: this.photos(r.id)[0] ?? "",
      status: r.status,
      createdAt: r.created_at,
      seller: author({ ...seller, user_id: seller.id }),
      isOwner: !!viewerId && viewerId === r.user_id,
      favorited,
    };
  }

  @Public()
  @Get("listings")
  list(
    @CurrentUser() viewer: { id: string } | undefined,
    @Query("q") q?: string,
    @Query("category") category?: string,
    @Query("maxPrice") maxPrice?: string,
    @Query("mine") mine?: string,
    @Query("page") page = "1",
    @Query("pageSize") pageSize = "24",
  ) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (mine === "true" && viewer) {
      where.push("user_id = ?");
      params.push(viewer.id);
    } else {
      where.push("status = 'available'");
    }
    if (category && category !== "All categories") { where.push("category = ?"); params.push(category); }
    if (maxPrice && Number(maxPrice) > 0) { where.push("price <= ?"); params.push(Number(maxPrice)); }
    if (q?.trim()) {
      where.push("(LOWER(title) LIKE ? OR LOWER(description) LIKE ?)");
      const term = `%${q.trim().toLowerCase()}%`;
      params.push(term, term);
    }
    const clause = where.join(" AND ");
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${clause}`).get(...params) as { n: number }).n;
    const size = Math.min(100, Math.max(1, Number(pageSize) || 24));
    const offset = (Math.max(1, Number(page) || 1) - 1) * size;
    const rows = this.db.prepare(`SELECT * FROM listings WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, size, offset) as Row[];
    return { items: rows.map((r) => this.view(r, viewer?.id)), total };
  }

  @Post("listings")
  create(@CurrentUser() user: { id: string }, @Body() dto: ListingDto) {
    const photos = dto.photos ?? [];
    assertPhotos(photos);
    const id = newId();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO listings (id, user_id, title, description, price, category, condition, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?)`)
        .run(id, user.id, dto.title.trim(), dto.description.trim(), round2(dto.price), dto.category, dto.condition, nowIso());
      this.setPhotos(id, photos);
    })();
    return this.view(this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row, user.id);
  }

  @Public()
  @Get("listings/:id")
  get(@CurrentUser() viewer: { id: string } | undefined, @Param("id") id: string) {
    const listing = this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row | undefined;
    const visible = listing && (listing.status === "available" || listing.user_id === viewer?.id);
    if (!listing || !visible) throw new NotFoundException();
    return this.view(listing, viewer?.id);
  }

  @Patch("listings/:id")
  update(@CurrentUser() user: { id: string }, @Param("id") id: string, @Body() dto: ListingUpdateDto) {
    this.sellerListing(id, user.id);
    if (dto.photos) assertPhotos(dto.photos);
    this.db.transaction(() => {
      this.db.prepare(`UPDATE listings SET title = COALESCE(?, title), description = COALESCE(?, description),
          price = COALESCE(?, price), category = COALESCE(?, category), condition = COALESCE(?, condition) WHERE id = ?`)
        .run(dto.title?.trim() ?? null, dto.description?.trim() ?? null, dto.price === undefined ? null : round2(dto.price),
          dto.category ?? null, dto.condition ?? null, id);
      if (dto.photos) this.setPhotos(id, dto.photos);
    })();
    return this.view(this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row, user.id);
  }

  @Delete("listings/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    this.sellerListing(id, user.id);
    this.db.prepare("DELETE FROM listings WHERE id = ?").run(id);
  }

  @Post("listings/:id/status")
  setStatus(@CurrentUser() user: { id: string }, @Param("id") id: string, @Body() dto: StatusDto) {
    this.sellerListing(id, user.id);
    this.db.prepare("UPDATE listings SET status = ? WHERE id = ?").run(dto.status, id);
    return this.view(this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row, user.id);
  }

  /** Records a sale outcome; a completed sale marks the listing as sold. */
  @Post("listings/:id/sale")
  recordSale(@CurrentUser() user: { id: string }, @Param("id") id: string, @Body() dto: SaleDto) {
    const listing = this.sellerListing(id, user.id);
    const saleId = newId();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO sales (id, user_id, listing_id, outcome, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(saleId, user.id, id, dto.outcome, round2(dto.amount ?? listing.price), nowIso());
      if (dto.outcome === "completed") this.db.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(id);
    })();
    return { saleId, listing: this.view(this.db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Row, user.id) };
  }

  @Put("listings/:id/favorite")
  @HttpCode(HttpStatus.NO_CONTENT)
  favorite(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    const listing = this.db.prepare("SELECT 1 FROM listings WHERE id = ? AND status = 'available'").get(id);
    if (!listing) throw new NotFoundException();
    this.db.prepare("INSERT OR IGNORE INTO favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)").run(user.id, id, nowIso());
  }

  @Delete("listings/:id/favorite")
  @HttpCode(HttpStatus.NO_CONTENT)
  unfavorite(@CurrentUser() user: { id: string }, @Param("id") id: string) {
    this.db.prepare("DELETE FROM favorites WHERE user_id = ? AND listing_id = ?").run(user.id, id);
  }

  @Get("favorites")
  favorites(@CurrentUser() user: { id: string }) {
    const rows = this.db.prepare(`
      SELECT l.* FROM favorites f JOIN listings l ON l.id = f.listing_id
      WHERE f.user_id = ? AND l.status = 'available' ORDER BY f.created_at DESC`).all(user.id) as Row[];
    return rows.map((r) => this.view(r, user.id));
  }
}
