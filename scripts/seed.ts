import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { openDatabase } from "../server/database/open";
import { hashPassword, newId, nowIso } from "../server/common/security";

/**
 * Adds the sample sellers and marketplace listings from the design.
 * Run with `npm run seed`. Safe to run more than once: existing rows are skipped.
 */
const SELLERS = [
  { firstName: "Jordan", lastName: "Smith", email: "jordan.smith@example.com" },
  { firstName: "Maya", lastName: "Kim", email: "maya.kim@example.com" },
];

const LISTINGS = [
  {
    seller: "jordan.smith@example.com",
    title: "Wireless Headphones",
    description: "Noise-cancelling over-ear headphones, used for one semester. Includes the original case.",
    price: 85,
    category: "Electronics",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=500&q=80",
  },
  {
    seller: "maya.kim@example.com",
    title: "Ergonomic Desk Chair",
    description: "Adjustable lumbar support and armrests. Small scuff on the left armrest, otherwise solid.",
    price: 140,
    category: "Home",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1688578735427-994ecdea3ea4?auto=format&fit=crop&w=500&q=80",
  },
];

const file = process.env.DATABASE_FILE ?? join(process.cwd(), "data", "saviny.db");
const db = openDatabase(file);

async function main(): Promise<void> {
  const userIds = new Map<string, string>();
  for (const seller of SELLERS) {
    const existing = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(seller.email) as { id: string } | undefined;
    if (existing) {
      userIds.set(seller.email, existing.id);
      continue;
    }
    // Sellers are seeded without a known password: nobody can sign in as them, they only own listings.
    const id = newId();
    const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
    db.prepare("INSERT INTO users (id, first_name, last_name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, seller.firstName, seller.lastName, seller.email, passwordHash, nowIso());
    userIds.set(seller.email, id);
  }

  const insertListing = db.prepare(
    "INSERT INTO listings (id, user_id, title, description, price, category, condition, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?)",
  );
  const insertPhoto = db.prepare("INSERT INTO listing_photos (listing_id, position, url) VALUES (?, 0, ?)");
  let added = 0;
  db.transaction(() => {
    for (const item of LISTINGS) {
      const userId = userIds.get(item.seller)!;
      const exists = db.prepare("SELECT id FROM listings WHERE user_id = ? AND title = ?").get(userId, item.title);
      if (exists) continue;
      const id = newId();
      insertListing.run(id, userId, item.title, item.description, item.price, item.category, item.condition, nowIso());
      insertPhoto.run(id, item.image);
      added += 1;
    }
  })();
  console.log(`Seed complete: ${userIds.size} sellers ensured, ${added} listings added (${file}).`);
}

main().finally(() => db.close());
