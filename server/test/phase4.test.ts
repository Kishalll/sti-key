import assert from "node:assert";
import http from "node:http";
import { WebSocket } from "ws";
import { whatsAppService } from "../src/services/WhatsAppService.js";
import { wsService } from "../src/ws/WebSocketService.js";
import { db } from "../src/db/index.js";
import { tagIndex } from "../src/services/TagIndexService.js";
import type { WAMessage } from "@whiskeysockets/baileys";

console.log("Running Phase 4 Verification: WhatsApp Companion and Sticker Saver...");

async function runTests(): Promise<void> {
  // Clean db and reload index
  db.exec("DELETE FROM stickers;");
  tagIndex.reloadFromDatabase();

  // 1. Test message parser: trigger rules
  const notFromMeMsg: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: false, id: "msg1" },
    message: { conversation: ".cat" },
  };
  assert.strictEqual(whatsAppService.parseMessage(notFromMeMsg).type, "ignore", "Must ignore messages not sent by me");

  const nonDotMsg: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg2" },
    message: { conversation: "hello there" },
  };
  assert.strictEqual(whatsAppService.parseMessage(nonDotMsg).type, "ignore", "Must ignore messages without dot prefix");

  const multiDotMsg: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg3" },
    message: { conversation: "...okay" },
  };
  assert.strictEqual(whatsAppService.parseMessage(multiDotMsg).type, "ignore", "Must ignore messages with multiple dots");

  const spaceMsg: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg4" },
    message: { conversation: ". how are you" },
  };
  assert.strictEqual(whatsAppService.parseMessage(spaceMsg).type, "ignore", "Must ignore trigger with space");

  const validTagMsg: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg5" },
    message: { conversation: ".cat_laugh" },
  };
  const validParsed = whatsAppService.parseMessage(validTagMsg);
  assert.strictEqual(validParsed.type, "tag");
  assert.strictEqual(validParsed.tag, "cat_laugh");

  // 2. Test .save command parser
  const saveWithoutQuote: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg6" },
    message: { conversation: ".save" },
  };
  const saveNoQuoteParsed = whatsAppService.parseMessage(saveWithoutQuote);
  assert.strictEqual(saveNoQuoteParsed.type, "save");
  assert.strictEqual(saveNoQuoteParsed.quotedSticker, false, "Must detect when not quoting a sticker");

  const saveWithStickerQuote: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg7" },
    message: {
      extendedTextMessage: {
        text: ".save funny_meme",
        contextInfo: {
          stanzaId: "quote123",
          participant: "friend@s.whatsapp.net",
          quotedMessage: {
            stickerMessage: {
              url: "https://example.com/sticker.webp",
              fileSha256: Buffer.from("test"),
            },
          },
        },
      },
    },
  };
  const saveQuotedParsed = whatsAppService.parseMessage(saveWithStickerQuote);
  assert.strictEqual(saveQuotedParsed.type, "save");
  assert.strictEqual(saveQuotedParsed.tag, "funny_meme");
  assert.strictEqual(saveQuotedParsed.quotedSticker, true);

  // Test bare .save defaults to untitled1
  const bareSaveWithStickerQuote: WAMessage = {
    key: { remoteJid: "12345@s.whatsapp.net", fromMe: true, id: "msg8" },
    message: {
      extendedTextMessage: {
        text: ".save",
        contextInfo: {
          stanzaId: "quote456",
          participant: "friend@s.whatsapp.net",
          quotedMessage: {
            stickerMessage: {
              url: "https://example.com/sticker2.webp",
            },
          },
        },
      },
    },
  };
  const bareSaveParsed = whatsAppService.parseMessage(bareSaveWithStickerQuote);
  assert.strictEqual(bareSaveParsed.type, "save");
  assert.strictEqual(bareSaveParsed.tag, "untitled1", "Bare .save must auto-name with untitled1");
  assert.strictEqual(bareSaveParsed.quotedSticker, true);

  // 3. Test quoted message context preservation builder
  const quotedOption = whatsAppService.buildQuotedOption(saveWithStickerQuote);
  assert(quotedOption, "Quoted option should be built when contextInfo exists");
  assert.strictEqual(quotedOption.quoted.key.id, "quote123");
  assert.strictEqual(quotedOption.quoted.key.remoteJid, "12345@s.whatsapp.net");
  assert(quotedOption.quoted.message.stickerMessage);

  // 4. Test WebSocket interactive picker and toast flows
  const server = http.createServer();
  wsService.attach(server);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);

  let receivedStatus = false;
  let receivedPickerOpen = false;
  let receivedToast = false;
  let pickerSelected = false;

  wsService.onPickerSelect = (triggerId, stickerId) => {
    assert.strictEqual(triggerId, "trig-101");
    assert.strictEqual(stickerId, "stk-999");
    pickerSelected = true;
  };

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      // 4a. Trigger picker open
      wsService.broadcastPickerOpen("trig-101", "cat", [
        {
          id: "stk-999",
          tag: "cat",
          file_path: "cat.webp",
          is_animated: 0,
          file_size: 15000,
          created_at: 1000,
        },
      ]);

      // 4b. Trigger toast notify
      wsService.broadcastToast({
        status: "success",
        message: "Saved sticker as: funny_cat",
        tag: "funny_cat",
      });
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "WA_STATUS") {
        receivedStatus = true;
      }
      if (msg.type === "PICKER_OPEN") {
        receivedPickerOpen = true;
        assert.strictEqual(msg.triggerId, "trig-101");
        assert.strictEqual(msg.candidates.length, 1);

        // Simulate client selecting sticker
        ws.send(
          JSON.stringify({
            type: "PICKER_SELECT",
            triggerId: "trig-101",
            stickerId: "stk-999",
          })
        );
      }
      if (msg.type === "TOAST_NOTIFY") {
        receivedToast = true;
        assert.strictEqual(msg.status, "success");
        assert.strictEqual(msg.tag, "funny_cat");
      }

      if (receivedStatus && receivedPickerOpen && receivedToast && pickerSelected) {
        resolve();
      }
    });

    setTimeout(() => {
      if (receivedStatus && receivedPickerOpen && receivedToast && pickerSelected) {
        resolve();
      } else {
        reject(
          new Error(
            `WebSocket test timed out: status=${receivedStatus}, picker=${receivedPickerOpen}, toast=${receivedToast}, selected=${pickerSelected}`
          )
        );
      }
    }, 2000);
  });

  ws.close();
  server.close();

  console.log("Phase 4 WhatsApp companion and sticker saver tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Phase 4 test failed:", err);
  process.exit(1);
});
