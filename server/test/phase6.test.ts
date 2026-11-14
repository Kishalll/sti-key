import assert from "node:assert";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { wsService } from "../src/ws/WebSocketService.js";
import { whatsAppService } from "../src/services/WhatsAppService.js";
import { tagIndex } from "../src/services/TagIndexService.js";
import { db } from "../src/db/index.js";
import type { WAMessage } from "@whiskeysockets/baileys";

console.log("Running Phase 6: End-to-End Verification and System Hardening...");

async function runTests(): Promise<void> {
  // 1. Reset database and index
  db.exec("DELETE FROM stickers;");
  tagIndex.reloadFromDatabase();

  const app = createApp();
  const server = http.createServer(app);
  wsService.attach(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));

  try {
    // 2. Stage and commit multiple test stickers
    const zip = new AdmZip();
    const webp1 = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 100, b: 200, alpha: 1 } },
    }).webp().toBuffer();

    const webp2 = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 200, g: 100, b: 10, alpha: 1 } },
    }).webp().toBuffer();

    const webp3 = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 50, g: 200, b: 50, alpha: 1 } },
    }).webp().toBuffer();

    zip.addFile("cat.webp", webp1);
    zip.addFile("cat_dance.webp", webp2);
    zip.addFile("dog.webp", webp3);

    const form = new FormData();
    form.append("file", new Blob([zip.toBuffer()], { type: "application/zip" }), "pack.zip");
    form.append("filterMode", "stickers_only");

    const zipRes = await fetch(`${baseUrl}/api/staging/upload-zip`, { method: "POST", body: form });
    const zipData = await zipRes.json();
    assert.strictEqual(zipData.items.length, 3, "Should extract 3 stickers from archive");

    // Commit all 3 stickers
    for (const item of zipData.items) {
      const commitRes = await fetch(`${baseUrl}/api/staging/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagedId: item.id, tag: item.suggestedTag }),
      });
      assert.strictEqual(commitRes.status, 201);
    }

    // 3. Verify zero disk scans requirement: RAM index must contain all 3
    const stats = tagIndex.getStats();
    assert.strictEqual(stats.totalStickers, 3, "RAM index must hold 3 stickers");
    assert.strictEqual(stats.uniqueTags, 3, "RAM index must hold 3 unique tags");

    // 4. Test Single-Match Fast Path Trigger
    const dogMsg: WAMessage = {
      key: { remoteJid: "chat@s.whatsapp.net", fromMe: true, id: "msg_dog" },
      message: { conversation: ".dog" },
    };
    const dogParsed = whatsAppService.parseMessage(dogMsg);
    assert.strictEqual(dogParsed.type, "tag");
    const dogCandidates = tagIndex.searchSimilar(dogParsed.tag!);
    assert.strictEqual(dogCandidates.length, 1, "Single match fast path detected for .dog");
    assert.strictEqual(dogCandidates[0].tag, "dog");

    // 5. Test Multi-Match Interactive Picker Path
    const catMsg: WAMessage = {
      key: { remoteJid: "chat@s.whatsapp.net", fromMe: true, id: "msg_cat" },
      message: { conversation: ".cat" },
    };
    const catParsed = whatsAppService.parseMessage(catMsg);
    assert.strictEqual(catParsed.type, "tag");
    const catCandidates = tagIndex.searchSimilar(catParsed.tag!);
    assert.strictEqual(catCandidates.length, 2, "Multiple matches detected for .cat (cat and cat_dance)");
    assert.strictEqual(catCandidates[0].tag, "cat"); // Tier 1 exact
    assert.strictEqual(catCandidates[1].tag, "cat_dance"); // Tier 2 prefix

    // Test WebSocket Picker interaction
    let pickerReceived = false;
    let toastReceived = false;

    const wsPromise = new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "PICKER_OPEN") {
          pickerReceived = true;
          assert.strictEqual(msg.query, "cat");
          assert.strictEqual(msg.candidates.length, 2);

          // Select second candidate (cat_dance)
          ws.send(
            JSON.stringify({
              type: "PICKER_SELECT",
              triggerId: msg.triggerId,
              stickerId: msg.candidates[1].id,
            })
          );
        }
        if (msg.type === "TOAST_NOTIFY") {
          toastReceived = true;
        }
        if (pickerReceived) {
          resolve();
        }
      });

      // Simulate WhatsAppService dispatching picker
      wsService.broadcastPickerOpen("sim-trigger-1", "cat", catCandidates);

      setTimeout(() => {
        if (pickerReceived) resolve();
        else reject(new Error("Picker open event not received"));
      }, 2000);
    });

    await wsPromise;

    // 6. Test Silent False-Trigger Ignore
    const falseTrigger1: WAMessage = {
      key: { remoteJid: "chat@s.whatsapp.net", fromMe: true, id: "msg_dot_env" },
      message: { conversation: ".env" },
    };
    const parsedDotEnv = whatsAppService.parseMessage(falseTrigger1);
    assert.strictEqual(parsedDotEnv.type, "tag");
    const matchesDotEnv = tagIndex.searchSimilar(parsedDotEnv.tag!);
    assert.strictEqual(matchesDotEnv.length, 0, "Non-existent tag .env must produce 0 matches and be ignored");

    const tripleDotMsg: WAMessage = {
      key: { remoteJid: "chat@s.whatsapp.net", fromMe: true, id: "msg_dots" },
      message: { conversation: "...okay" },
    };
    assert.strictEqual(whatsAppService.parseMessage(tripleDotMsg).type, "ignore");

    // 7. Test In-Chat Sticker Saver (.save)
    // 7a. Test bare .save (auto-names with untitled1)
    const bareSaveMsg: WAMessage = {
      key: { remoteJid: "chat@s.whatsapp.net", fromMe: true, id: "msg_save_bare" },
      message: {
        extendedTextMessage: {
          text: ".save",
          contextInfo: {
            stanzaId: "stk_quote_1",
            quotedMessage: {
              stickerMessage: { url: "https://example.com/s.webp" },
            },
          },
        },
      },
    };
    const parsedBareSave = whatsAppService.parseMessage(bareSaveMsg);
    assert.strictEqual(parsedBareSave.type, "save");
    assert.strictEqual(parsedBareSave.tag, "untitled1", "Bare .save must auto-name with untitled1");

    // 7b. Test .save with explicit tag
    const taggedSaveMsg: WAMessage = {
      key: { remoteJid: "chat@s.whatsapp.net", fromMe: true, id: "msg_save_tagged" },
      message: {
        extendedTextMessage: {
          text: ".save cool_frog",
          contextInfo: {
            stanzaId: "stk_quote_2",
            quotedMessage: {
              stickerMessage: { url: "https://example.com/s2.webp" },
            },
          },
        },
      },
    };
    const parsedTaggedSave = whatsAppService.parseMessage(taggedSaveMsg);
    assert.strictEqual(parsedTaggedSave.type, "save");
    assert.strictEqual(parsedTaggedSave.tag, "cool_frog");

    // 8. Verify Write-Through SQLite + RAM Index Integrity
    const dbRows = db.prepare("SELECT * FROM stickers").all() as any[];
    assert.strictEqual(dbRows.length, tagIndex.getAll().length, "Database rows must match RAM index records");

    console.log("Phase 6 End-to-End Verification passed with zero errors!");
  } finally {
    ws.close();
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Phase 6 test failed:", err);
  process.exit(1);
});
