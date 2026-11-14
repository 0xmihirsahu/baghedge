import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FundingQuote } from "./intents";

type TransferRow = { quote: string; created_at: number };

export function openTransfers(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      environment TEXT NOT NULL,
      quote TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  const insert = db.query("INSERT INTO transfers VALUES ($id, $environment, $quote, $now)");
  const get = db.query<TransferRow, { id: string; environment: string }>(
    "SELECT quote, created_at FROM transfers WHERE id = $id AND environment = $environment",
  );
  return {
    save(environment: string, quote: FundingQuote) {
      const id = crypto.randomUUID();
      insert.run({ id, environment, quote: JSON.stringify(quote), now: Date.now() });
      return id;
    },
    get(environment: string, id: string) {
      const row = get.get({ id, environment });
      if (!row) return null;
      const quote: FundingQuote = JSON.parse(row.quote);
      return { quote, createdAt: row.created_at };
    },
    close() { db.close(); },
  };
}
