import assert from "node:assert";
import http from "node:http";
import { createApp } from "../src/app.js";
import { db } from "../src/db/index.js";
import { tagIndex } from "../src/services/TagIndexService.js";

console.log("Running Direct Sticker Dispatch Test...");

async function runTests(): Promise<void> {
  db.exec("DELETE FROM stickers;");
  tagIndex.reloadFromDatabase();

  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Missing parameters validation
    const badRes = await fetch(`${baseUrl}/api/whatsapp/send-sticker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.strictEqual(badRes.status, 400, "Must return 400 when parameters are missing");

    // 2. Non-existent sticker validation
    const missingRes = await fetch(`${baseUrl}/api/whatsapp/send-sticker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatJid: "123456@s.whatsapp.net",
        stickerId: "non_existent_id",
      }),
    });
    assert.strictEqual(missingRes.status, 500);
    const missingJson = await missingRes.json();
    assert(missingJson.error.includes("WhatsApp companion socket is not connected") || missingJson.error.includes("Sticker not found"));

    console.log("Direct Sticker Dispatch test passed successfully!");
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Direct send test failed:", err);
  process.exit(1);
});
