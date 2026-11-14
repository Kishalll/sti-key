import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const storageDir = path.resolve(process.cwd(), "../storage");
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

const dbPath = path.join(storageDir, "stickers.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stickers (
      id TEXT PRIMARY KEY,
      tag TEXT NOT NULL,
      file_path TEXT NOT NULL,
      is_animated INTEGER NOT NULL,
      file_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stickers_tag ON stickers(tag);
  `);
}
