import { MongoClient, type Sort } from "mongodb";
import { ensureIndexes } from "./indexes";
import type { Row } from "./types";

/** Exact field matches, plus operators such as $in, $lt and $ne. */
export type Filter = Record<string, any>;

export interface Find {
  sort?: Sort;
  skip?: number;
  limit?: number;
}

/**
 * Collection access used by the modules. Documents keep the snake_case field names of the former
 * SQL columns, and reads never return MongoDB's own _id.
 */
export interface Store {
  one(table: string, filter: Filter, sort?: Sort): Promise<Row | null>;
  many(table: string, filter?: Filter, find?: Find): Promise<Row[]>;
  count(table: string, filter?: Filter): Promise<number>;
  insert(table: string, rows: Row | Row[]): Promise<void>;
  /** Sets fields on every match and returns how many documents matched. */
  update(table: string, filter: Filter, set: Row): Promise<number>;
  remove(table: string, filter: Filter): Promise<number>;
  /** Deletes the whole database. Only the tests use it. */
  drop(): Promise<void>;
  close(): Promise<void>;
}

const NO_ID = { _id: 0 };

export async function connectStore(uri: string, database: string): Promise<Store> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(database);
  await ensureIndexes(db);
  const col = (table: string) => db.collection<Row>(table);

  return {
    one: (table, filter, sort) => col(table).findOne(filter, { projection: NO_ID, sort }),

    async many(table, filter = {}, find = {}) {
      let cursor = col(table).find(filter, { projection: NO_ID, sort: find.sort });
      if (find.skip) cursor = cursor.skip(find.skip);
      if (find.limit) cursor = cursor.limit(find.limit);
      return cursor.toArray();
    },

    count: (table, filter = {}) => col(table).countDocuments(filter),

    async insert(table, rows) {
      const docs = (Array.isArray(rows) ? rows : [rows]).map((doc) => ({ ...doc }));
      if (docs.length === 1) await col(table).insertOne(docs[0]);
      else if (docs.length > 1) await col(table).insertMany(docs);
    },

    async update(table, filter, set) {
      // An update with no fields changes nothing, but still reports how many documents it matched.
      if (Object.keys(set).length === 0) return col(table).countDocuments(filter);
      const result = await col(table).updateMany(filter, { $set: set });
      return result.matchedCount;
    },

    async remove(table, filter) {
      return (await col(table).deleteMany(filter)).deletedCount;
    },

    async drop() {
      await db.dropDatabase();
    },
    close: () => client.close(),
  };
}

/** True when a write was refused by a unique index. */
export const isDuplicateKey = (err: unknown): boolean => (err as { code?: number } | null)?.code === 11000;

/** Escapes text for use inside a case-insensitive $regex. */
export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
