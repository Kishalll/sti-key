import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { tagIndex } from "../src/services/TagIndexService.js";
import { StickerRecord } from "../types/index.js";

console.log("Running Phase 3 Verification: REST API and Staging Service...");

async function runTests(): Promise<void> {
  // Clean database and reload index
  db.exec("DELETE FROM stickers;");
  tagIndex.reloadFromDatabase();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(healthRes.status, 200, "Health endpoint should return 200");
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, "ok");

    // 2. Initial stickers list empty
    const listRes = await fetch(`${baseUrl}/api/stickers`);
    assert.strictEqual(listRes.status, 200);
    const listJson = await listRes.json();
    assert.strictEqual(listJson.stickers.length, 0);
    assert.strictEqual(listJson.stats.totalStickers, 0);

    // 3. Upload single sticker via POST /api/stickers/upload
    const testImageBuffer = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 255, g: 100, b: 50, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const form = new FormData();
    form.append("file", new Blob([testImageBuffer], { type: "image/png" }), "my_orange_cat.png");
    form.append("tag", "orange_cat");
    form.append("mode", "fit");

    const uploadRes = await fetch(`${baseUrl}/api/stickers/upload`, {
      method: "POST",
      body: form,
    });

    assert.strictEqual(uploadRes.status, 201, "Sticker upload should return 201");
    const createdSticker: StickerRecord = await uploadRes.json();
    assert.strictEqual(createdSticker.tag, "orange_cat");
    assert.strictEqual(createdSticker.is_animated, 0);
    assert(createdSticker.file_size <= 102400, "Uploaded sticker size must be under 100 KB");

    const stickerDiskPath = path.resolve(process.cwd(), "../storage/stickers", createdSticker.file_path);
    assert(fs.existsSync(stickerDiskPath), "Saved sticker WebP file must exist on disk");

    // 4. Update tag via PATCH /api/stickers/:id
    const patchRes = await fetch(`${baseUrl}/api/stickers/${createdSticker.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: "super_orange_cat" }),
    });

    assert.strictEqual(patchRes.status, 200, "Tag update should return 200");
    const patchedSticker: StickerRecord = await patchRes.json();
    assert.strictEqual(patchedSticker.tag, "super_orange_cat");

    // Verify search matches new tag
    const searchRes = await fetch(`${baseUrl}/api/stickers?search=super_orange`);
    const searchJson = await searchRes.json();
    assert.strictEqual(searchJson.stickers.length, 1);
    assert.strictEqual(searchJson.stickers[0].id, createdSticker.id);

    // 5. Delete sticker via DELETE /api/stickers/:id
    const deleteRes = await fetch(`${baseUrl}/api/stickers/${createdSticker.id}`, {
      method: "DELETE",
    });
    assert.strictEqual(deleteRes.status, 200);
    assert(!fs.existsSync(stickerDiskPath), "Deleted sticker WebP file must be removed from disk");

    // 6. Test Staging: Zip extraction
    const zip = new AdmZip();
    const sampleWebp1 = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } },
    }).webp().toBuffer();

    const sampleWebp2 = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 10, b: 200, alpha: 1 } },
    }).webp().toBuffer();

    zip.addFile("happy_puppy.webp", sampleWebp1);
    zip.addFile("STK-20231114-WA0009.webp", sampleWebp2);
    zip.addFile("notes.txt", Buffer.from("this is a text file"));

    const zipBuffer = zip.toBuffer();

    const zipForm = new FormData();
    zipForm.append("file", new Blob([zipBuffer], { type: "application/zip" }), "stickers.zip");
    zipForm.append("filterMode", "stickers_only");

    const zipRes = await fetch(`${baseUrl}/api/staging/upload-zip`, {
      method: "POST",
      body: zipForm,
    });

    assert.strictEqual(zipRes.status, 200, "Zip upload should return 200");
    const zipJson = await zipRes.json();
    assert.strictEqual(zipJson.items.length, 2, "Only 2 webp stickers should be extracted in stickers_only mode");

    const puppyItem = zipJson.items.find((i: any) => i.fileName === "happy_puppy.webp");
    const genericItem = zipJson.items.find((i: any) => i.fileName === "STK-20231114-WA0009.webp");

    assert(puppyItem, "Puppy item should exist in staging");
    assert.strictEqual(puppyItem.suggestedTag, "happy_puppy", "Suggested tag should match filename");

    assert(genericItem, "Generic WA item should exist in staging");
    assert.strictEqual(genericItem.suggestedTag, "", "Generic WA export should have empty suggested tag");

    // 7. Commit staged item
    const commitRes = await fetch(`${baseUrl}/api/staging/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stagedId: puppyItem.id,
        tag: "doggo_smile",
        mode: "fit",
      }),
    });

    assert.strictEqual(commitRes.status, 201, "Staged commit should return 201");
    const committedSticker: StickerRecord = await commitRes.json();
    assert.strictEqual(committedSticker.tag, "doggo_smile");
    assert(!fs.existsSync(puppyItem.filePath), "Staged temp file should be deleted upon commit");

    // 8. Discard staged item
    const discardRes = await fetch(`${baseUrl}/api/staging/${genericItem.id}`, {
      method: "DELETE",
    });
    assert.strictEqual(discardRes.status, 200, "Discard should return 200");
    assert(!fs.existsSync(genericItem.filePath), "Discarded staged file must be removed from disk");

    console.log("Phase 3 REST API and Staging tests passed successfully!");
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Phase 3 test failed:", err);
  process.exit(1);
});
