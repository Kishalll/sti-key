import assert from "node:assert";
import { v4 as uuidv4 } from "uuid";
import { tagIndex } from "../src/services/TagIndexService.js";
import { db } from "../src/db/index.js";

console.log("Running Phase 1 Verification in unified test folder...");

// Reset table for test
db.exec("DELETE FROM stickers;");
tagIndex.reloadFromDatabase();

// 1. Initial state
assert.strictEqual(tagIndex.getAll().length, 0, "Index should be empty initially");
assert.strictEqual(tagIndex.getNextUntitledTag(), "untitled1", "First default tag should be untitled1");

// 2. Insert records
const cat1 = {
  id: uuidv4(),
  tag: "cat",
  file_path: "cat1.webp",
  is_animated: 0,
  file_size: 20480,
  created_at: 1000,
};

const cat2 = {
  id: uuidv4(),
  tag: "cat",
  file_path: "cat2.webp",
  is_animated: 0,
  file_size: 25600,
  created_at: 2000,
};

const catPrefix = {
  id: uuidv4(),
  tag: "cat_laugh",
  file_path: "cat_laugh.webp",
  is_animated: 1,
  file_size: 150000,
  created_at: 3000,
};

const catSubstr = {
  id: uuidv4(),
  tag: "cool_cat_vibes",
  file_path: "cool_cat.webp",
  is_animated: 0,
  file_size: 30000,
  created_at: 4000,
};

const dog = {
  id: uuidv4(),
  tag: "dog",
  file_path: "dog.webp",
  is_animated: 0,
  file_size: 18000,
  created_at: 5000,
};

tagIndex.insert(cat1);
tagIndex.insert(cat2);
tagIndex.insert(catPrefix);
tagIndex.insert(catSubstr);
tagIndex.insert(dog);

// 3. Stats and database persistence checks
const stats = tagIndex.getStats();
assert.strictEqual(stats.totalStickers, 5, "Total stickers should be 5");
assert.strictEqual(stats.uniqueTags, 4, "Unique tags should be 4 (cat, cat_laugh, cool_cat_vibes, dog)");

const dbCount = db.prepare("SELECT COUNT(*) as count FROM stickers").get() as { count: number };
assert.strictEqual(dbCount.count, 5, "Database row count must match RAM count");

// 4. Three-tier search check for 'cat'
const searchResults = tagIndex.searchSimilar("cat");
assert.strictEqual(searchResults.length, 4, "Search for 'cat' should match 4 stickers");
assert.strictEqual(searchResults[0].tag, "cat");
assert.strictEqual(searchResults[1].tag, "cat");
assert.strictEqual(searchResults[2].tag, "cat_laugh");
assert.strictEqual(searchResults[3].tag, "cool_cat_vibes");

// 5. Default untitled progression
tagIndex.insert({
  id: uuidv4(),
  tag: "untitled1",
  file_path: "u1.webp",
  is_animated: 0,
  file_size: 10000,
  created_at: 6000,
});
assert.strictEqual(tagIndex.getNextUntitledTag(), "untitled2", "Should return untitled2 after untitled1 is added");

// 6. Update and delete checks
tagIndex.updateTag(cat1.id, "cat_sleeping");
assert.strictEqual(tagIndex.getById(cat1.id)?.tag, "cat_sleeping", "RAM record must reflect updated tag");

const updatedDbRow = db.prepare("SELECT tag FROM stickers WHERE id = ?").get(cat1.id) as { tag: string };
assert.strictEqual(updatedDbRow.tag, "cat_sleeping", "Database record must reflect updated tag");

tagIndex.delete(cat1.id);
assert.strictEqual(tagIndex.getById(cat1.id), undefined, "Deleted record must be removed from RAM");

const deletedDbRow = db.prepare("SELECT COUNT(*) as count FROM stickers WHERE id = ?").get(cat1.id) as { count: number };
assert.strictEqual(deletedDbRow.count, 0, "Deleted record must be removed from database");

console.log("Phase 1 unified test passed successfully!");
