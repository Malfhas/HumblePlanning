import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import * as relations from "./relations";

const allSchema = { ...schema, ...relations };

function createDb() {
  return drizzle(process.env.DATABASE_URL!, { schema: allSchema });
}

// Prevent multiple DB pool instances during Next.js hot-reload in dev
const globalForDb = globalThis as unknown as {
  _db: ReturnType<typeof createDb> | undefined;
};

export const db = globalForDb._db ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb._db = db;
}
