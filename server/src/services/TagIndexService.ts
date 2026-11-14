import { db, initDatabase } from "../db/index.js";
import { StickerRecord, TagIndexStats } from "../types/index.js";

export class TagIndexService {
  private idMap = new Map<string, StickerRecord>();
  private exactTagMap = new Map<string, StickerRecord[]>();

  constructor() {
    initDatabase();
    this.reloadFromDatabase();
  }

  public reloadFromDatabase(): void {
    this.idMap.clear();
    this.exactTagMap.clear();

    const stmt = db.prepare("SELECT * FROM stickers ORDER BY created_at DESC");
    const records = stmt.all() as unknown as StickerRecord[];

    for (const record of records) {
      this.addToMaps(record);
    }
  }

  private addToMaps(record: StickerRecord): void {
    this.idMap.set(record.id, record);
    const existing = this.exactTagMap.get(record.tag) || [];
    existing.push(record);
    this.exactTagMap.set(record.tag, existing);
  }

  private removeFromMaps(record: StickerRecord): void {
    this.idMap.delete(record.id);
    const list = this.exactTagMap.get(record.tag);
    if (list) {
      const filtered = list.filter((item) => item.id !== record.id);
      if (filtered.length === 0) {
        this.exactTagMap.delete(record.tag);
      } else {
        this.exactTagMap.set(record.tag, filtered);
      }
    }
  }

  public normalizeTag(tag: string): string {
    return tag.trim().toLowerCase().replace(/\s+/g, "_");
  }

  public getById(id: string): StickerRecord | undefined {
    return this.idMap.get(id);
  }

  public getByExactTag(tag: string): StickerRecord[] {
    const normalized = this.normalizeTag(tag);
    return this.exactTagMap.get(normalized) || [];
  }

  public searchSimilar(query: string): StickerRecord[] {
    const q = this.normalizeTag(query);
    if (!q) return [];

    const tier1: StickerRecord[] = [];
    const tier2: StickerRecord[] = [];
    const tier3: StickerRecord[] = [];

    for (const [tag, records] of this.exactTagMap.entries()) {
      if (tag === q) {
        tier1.push(...records);
      } else if (tag.startsWith(q)) {
        tier2.push(...records);
      } else if (tag.includes(q)) {
        tier3.push(...records);
      }
    }

    const seen = new Set<string>();
    const result: StickerRecord[] = [];

    for (const record of [...tier1, ...tier2, ...tier3]) {
      if (!seen.has(record.id)) {
        seen.add(record.id);
        result.push(record);
      }
    }

    return result;
  }

  public getNextUntitledTag(): string {
    let index = 1;
    while (this.exactTagMap.has(`untitled${index}`)) {
      index++;
    }
    return `untitled${index}`;
  }

  public insert(record: StickerRecord): void {
    const normalizedRecord = {
      ...record,
      tag: this.normalizeTag(record.tag),
    };

    const stmt = db.prepare(`
      INSERT INTO stickers (id, tag, file_path, is_animated, file_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      normalizedRecord.id,
      normalizedRecord.tag,
      normalizedRecord.file_path,
      normalizedRecord.is_animated,
      normalizedRecord.file_size,
      normalizedRecord.created_at
    );

    this.addToMaps(normalizedRecord);
  }

  public updateTag(id: string, newTag: string): StickerRecord | null {
    const current = this.idMap.get(id);
    if (!current) return null;

    const normalizedTag = this.normalizeTag(newTag);
    const stmt = db.prepare("UPDATE stickers SET tag = ? WHERE id = ?");
    stmt.run(normalizedTag, id);

    this.removeFromMaps(current);
    const updated: StickerRecord = { ...current, tag: normalizedTag };
    this.addToMaps(updated);
    return updated;
  }

  public delete(id: string): StickerRecord | null {
    const current = this.idMap.get(id);
    if (!current) return null;

    const stmt = db.prepare("DELETE FROM stickers WHERE id = ?");
    stmt.run(id);

    this.removeFromMaps(current);
    return current;
  }

  public getStats(): TagIndexStats {
    return {
      totalStickers: this.idMap.size,
      uniqueTags: this.exactTagMap.size,
    };
  }

  public getAll(): StickerRecord[] {
    return Array.from(this.idMap.values()).sort((a, b) => b.created_at - a.created_at);
  }
}

export const tagIndex = new TagIndexService();
