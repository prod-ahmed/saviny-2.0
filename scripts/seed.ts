import { randomBytes } from "node:crypto";
import { connectStore } from "../server/database/store";
import { newUser } from "../server/common/domain";
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

const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const database = process.env.MONGODB_DB ?? "saviny";

async function main(): Promise<void> {
  const store = await connectStore(uri, database);
  try {
    const userIds = new Map<string, string>();
    for (const seller of SELLERS) {
      const existing = await store.one("users", { email: seller.email });
      if (existing) {
        userIds.set(seller.email, existing.id);
        continue;
      }
      // Sellers are seeded without a known password: nobody can sign in as them, they only own listings.
      const user = newUser({
        ...seller,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
        role: "member",
      });
      await store.insert("users", user);
      userIds.set(seller.email, user.id);
    }

    let added = 0;
    for (const item of LISTINGS) {
      const userId = userIds.get(item.seller)!;
      if (await store.one("listings", { user_id: userId, title: item.title })) continue;
      const id = newId();
      await store.insert("listings", {
        id, user_id: userId, title: item.title, description: item.description, price: item.price, category: item.category,
        condition: item.condition, status: "available", created_at: nowIso(),
      });
      await store.insert("listing_photos", { listing_id: id, position: 0, url: item.image });
      added += 1;
    }
    console.log(`Seed complete: ${userIds.size} sellers ensured, ${added} listings added (${uri}/${database}).`);
  } finally {
    await store.close();
  }
}

await main();
