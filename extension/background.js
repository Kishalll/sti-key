const SERVER_URL = "http://localhost:3001";

function bufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const extensionApi = typeof chrome !== "undefined" ? chrome : browser;

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SEARCH_STICKERS") {
    (async () => {
      try {
        const query = message.query || "";
        const res = await fetch(`${SERVER_URL}/api/stickers?search=${encodeURIComponent(query)}`);
        const data = await res.json();
        const stickers = data.stickers || [];

        // Convert each sticker webp to Base64 data URL to bypass WhatsApp Web img-src CSP
        const stickersWithDataUrls = await Promise.all(
          stickers.map(async (stk) => {
            try {
              const imgRes = await fetch(`${SERVER_URL}/stickers/${stk.file_path}`);
              const buffer = await imgRes.arrayBuffer();
              const base64 = bufferToBase64(buffer);
              return {
                ...stk,
                dataUrl: `data:image/webp;base64,${base64}`,
              };
            } catch (imgErr) {
              console.error("[Sti-Key Background] Failed to load image:", stk.file_path, imgErr);
              return stk;
            }
          })
        );

        sendResponse({ success: true, stickers: stickersWithDataUrls });
      } catch (err) {
        console.error("[Sti-Key Background] Search failed:", err);
        sendResponse({ success: false, stickers: [], error: String(err) });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (message.type === "SEND_STICKER_DIRECT") {
    (async () => {
      try {
        const { stickerId, chatJid, chatTitle, isSelfChat, recentStanzaIds, quotedStanzaId, quotedParticipant, quotedFromMe } = message;

        console.log("[Sti-Key Background] Attempting direct sticker dispatch:", {
          stickerId,
          chatJid,
          chatTitle,
          isSelfChat,
          recentStanzaIdsCount: recentStanzaIds?.length || 0,
          quotedStanzaId,
        });

        // 1. Try primary endpoint /api/whatsapp/send-direct
        let res = await fetch(`${SERVER_URL}/api/whatsapp/send-direct`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stickerId,
            chatJid,
            chatTitle,
            isSelfChat,
            recentStanzaIds,
            quotedStanzaId,
            quotedParticipant,
            quotedFromMe,
          }),
        });

        // 2. Fallback to /api/whatsapp/send-sticker if /send-direct is not registered (404)
        if (!res.ok && res.status === 404 && chatJid) {
          console.warn("[Sti-Key Background] /send-direct returned 404, falling back to /send-sticker");
          res = await fetch(`${SERVER_URL}/api/whatsapp/send-sticker`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatJid, stickerId }),
          });
        }

        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }

        console.log("[Sti-Key Background] Direct dispatch result:", { status: res.status, ok: res.ok, data });
        sendResponse({ success: res.ok, status: res.status, data });
      } catch (err) {
        console.error("[Sti-Key Background] Send direct error:", err);
        sendResponse({ success: false, error: String(err) });
      }
    })();
    return true;
  }

  if (message.type === "DEBUG_DOM") {
    (async () => {
      try {
        await fetch(`${SERVER_URL}/api/whatsapp/debug-dom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.data),
        });
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
    })();
    return true;
  }
});
