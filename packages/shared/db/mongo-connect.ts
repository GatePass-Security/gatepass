import { MongoClient } from "mongodb";
import { MongoStore, type MongoLike } from "./mongo-store.js";

/**
 * Attach a `MongoStore` to a live cluster.
 *
 * Split from `mongo-store.ts` so that file imports nothing from the driver and its logic can be
 * exercised against a fake. This module is the only place the real driver appears, and it does
 * three things: connect, verify the connection actually works, and create the indexes.
 *
 * ## Why it verifies rather than trusting `connect()`
 *
 * The Node driver's `connect()` resolves once it has *selected* a server, and with a
 * `mongodb+srv://` URI a bad password or an IP not on the Atlas access list frequently surfaces
 * later — on the first real operation, inside a request, as a 500. A `ping` here turns a
 * misconfiguration into a startup failure with the reason attached, which is where an operator
 * can act on it.
 */

export interface MongoConnection {
  store: MongoStore;
  close(): Promise<void>;
}

/** Connection timeouts, deliberately short: a boot that hangs tells nobody anything. */
const CONNECT_TIMEOUT_MS = 10_000;

export async function createMongoStore(uri: string, dbName?: string): Promise<MongoConnection> {
  if (uri.includes("<") || uri.includes(">")) {
    /*
     * An unfilled placeholder from a copy-pasted Atlas string — `mongodb+srv://<db_username>:…`.
     * The driver's own error for this is a URI parse failure that names neither the placeholder
     * nor the variable it came from, so it is caught here where both can be said.
     */
    throw new Error(
      "MONGODB_URI still contains a `<placeholder>`. Replace it with the real database username " +
        "and password from Atlas (Database Access → your user), then restart.",
    );
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
  });
  await client.connect();
  const db = client.db(dbName || undefined);
  // Proves credentials and network reachability now, rather than in the first request that
  // happens to touch the database.
  await db.command({ ping: 1 });

  const store = new MongoStore(db as unknown as MongoLike);
  await store.ensureIndexes();
  return { store, close: () => client.close() };
}
