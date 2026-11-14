// ==UserScript==
// @name         Sti-Key WhatsApp Web Sticker Picker
// @namespace    https://github.com/sti-key
// @version      1.0.0
// @description  Floating in-chat sticker picker and direct sticker sender for WhatsApp Web
// @match        https://web.whatsapp.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  const SERVER_URL = "http://localhost:3001";
  let activeCandidates = [];
  let selectedIndex = 0;
  let pickerElem = null;
  let activeQuery = "";
  let debounceTimer = null;

  // Inject Styles
  const style = document.createElement("style");
  style.textContent = `
    #stikey-floating-picker {
      position: absolute;
      bottom: 72px;
      left: 24px;
      right: 24px;
      max-width: 680px;
      margin: 0 auto;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(51, 65, 85, 0.8);
      border-radius: 18px;
      padding: 12px 14px;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(16, 185, 129, 0.15);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #f1f5f9;
      transition: opacity 0.15s ease, transform 0.15s ease;
      animation: stikey-slide-up 0.16s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes stikey-slide-up {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .stikey-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(51, 65, 85, 0.5);
      font-size: 11px;
    }
    .stikey-title { display: flex; align-items: center; gap: 6px; font-weight: 600; color: #e2e8f0; }
    .stikey-badge { background: #10b981; color: #022c22; font-weight: 700; padding: 1px 6px; border-radius: 6px; font-size: 10px; }
    .stikey-hint { color: #94a3b8; font-size: 10px; }
    .stikey-candidates-row {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
      gap: 8px;
      max-height: 220px;
      overflow-y: auto;
      padding: 2px;
    }
    .stikey-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 12px;
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(51, 65, 85, 0.6);
      cursor: pointer;
      transition: all 0.12s ease;
      position: relative;
      aspect-ratio: 1 / 1;
    }
    .stikey-card:hover { background: rgba(30, 41, 59, 0.9); border-color: #10b981; transform: translateY(-2px); }
    .stikey-card.stikey-selected {
      background: rgba(16, 185, 129, 0.12);
      border-color: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.4);
      transform: scale(1.04);
    }
    .stikey-img { width: 48px; height: 48px; object-fit: contain; margin-bottom: 4px; pointer-events: none; }
    .stikey-tag-label {
      font-size: 9px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #cbd5e1;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  function cleanInputText(str) {
    if (!str) return "";
    return str.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  }

  function extractJid(dataId) {
    if (!dataId) return null;
    const parts = dataId.split("_");
    for (const part of parts) {
      if (
        part.includes("@c.us") ||
        part.includes("@s.whatsapp.net") ||
        part.includes("@g.us") ||
        part.includes("@lid")
      ) {
        const clean = part.replace(/^_+|_+$/g, "");
        return clean.replace(/@c\.us$/i, "@s.whatsapp.net");
      }
    }
    return null;
  }

  function getActiveChatJid() {
    // 1. Scan message elements inside current chat pane
    const messageContainers = document.querySelectorAll("#main [data-id]");
    for (let i = messageContainers.length - 1; i >= 0; i--) {
      const dataId = messageContainers[i].getAttribute("data-id");
      const jid = extractJid(dataId);
      if (jid) return jid;
    }

    // 2. Scan active conversation in sidebar
    const activeChatItem = document.querySelector("#pane-side [aria-selected='true'] [data-id]");
    if (activeChatItem) {
      const jid = extractJid(activeChatItem.getAttribute("data-id"));
      if (jid) return jid;
    }

    // 3. Scan phone numbers in conversation header
    const headerTitle = document.querySelector("#main header [title]")?.getAttribute("title");
    if (headerTitle && /^\+?[0-9\s-]+$/.test(headerTitle)) {
      const cleanPhone = headerTitle.replace(/[^0-9]/g, "");
      if (cleanPhone.length >= 7) {
        return `${cleanPhone}@s.whatsapp.net`;
      }
    }

    return null;
  }

  function createPickerElement() {
    if (pickerElem) return pickerElem;
    pickerElem = document.createElement("div");
    pickerElem.id = "stikey-floating-picker";
    pickerElem.style.display = "none";
    document.body.appendChild(pickerElem);
    return pickerElem;
  }

  function renderPicker() {
    if (!pickerElem) createPickerElement();
    if (activeCandidates.length === 0) {
      hidePicker();
      return;
    }

    const footer = document.querySelector("#main footer") || document.querySelector("footer");
    if (footer) {
      const rect = footer.getBoundingClientRect();
      pickerElem.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      pickerElem.style.left = `${Math.max(16, rect.left + 16)}px`;
      pickerElem.style.width = `${Math.min(680, rect.width - 32)}px`;
    }

    pickerElem.innerHTML = `
      <div class="stikey-header">
        <div class="stikey-title">
          <span class="stikey-badge">.${activeQuery}</span>
          <span>Select Sticker</span>
        </div>
        <div class="stikey-hint">Enter or click to send · Tab / Arrows to navigate · Esc to close</div>
      </div>
      <div class="stikey-candidates-row">
        ${activeCandidates
          .map(
            (stk, idx) => `
          <div class="stikey-card ${idx === selectedIndex ? "stikey-selected" : ""}" data-index="${idx}">
            <img src="${SERVER_URL}/stickers/${stk.file_path}" alt="${stk.tag}" class="stikey-img" />
            <span class="stikey-tag-label">.${stk.tag}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    pickerElem.style.display = "block";

    const cards = pickerElem.querySelectorAll(".stikey-card");
    cards.forEach((card) => {
      card.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(card.getAttribute("data-index") || "0", 10);
        commitSelection(idx);
      });
    });
  }

  function hidePicker() {
    if (pickerElem) pickerElem.style.display = "none";
    activeCandidates = [];
    selectedIndex = 0;
    activeQuery = "";
  }

  function clearActiveInput() {
    const input =
      document.querySelector("#main footer div[contenteditable='true']") ||
      document.querySelector("footer div[contenteditable='true']");

    if (input) {
      input.focus();
      try {
        document.execCommand("selectAll", false, undefined);
        document.execCommand("delete", false, undefined);
      } catch {
        input.textContent = "";
      }
    }
  }

  async function commitSelection(idx) {
    const chosen = activeCandidates[idx];
    if (!chosen) {
      hidePicker();
      return;
    }

    const chatJid = getActiveChatJid();
    console.log("[Sti-Key Userscript] Committing selection:", { tag: chosen.tag, id: chosen.id, chatJid });

    if (!chatJid) {
      console.warn("[Sti-Key Userscript] Could not detect active chat JID");
      hidePicker();
      return;
    }

    clearActiveInput();
    hidePicker();

    try {
      const res = await fetch(`${SERVER_URL}/api/whatsapp/send-sticker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatJid, stickerId: chosen.id }),
      });
      const data = await res.json();
      console.log("[Sti-Key Userscript] Dispatch response:", data);
    } catch (err) {
      console.error("[Sti-Key Userscript] Failed to dispatch sticker directly:", err);
    }
  }

  async function searchStickers(query) {
    try {
      const res = await fetch(`${SERVER_URL}/api/stickers?search=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.stickers || [];
    } catch {
      return [];
    }
  }

  document.addEventListener(
    "input",
    (e) => {
      if (!e.isTrusted) return;

      const target = e.target;
      if (!target || !(target.isContentEditable || target.getAttribute("contenteditable") === "true")) return;

      const clean = cleanInputText(target.textContent);
      const match = clean.match(/^\.([a-zA-Z0-9_-]+)$/);

      if (match) {
        const query = match[1];
        activeQuery = query;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          const results = await searchStickers(query);
          activeCandidates = results;
          selectedIndex = 0;
          if (activeCandidates.length > 0) renderPicker();
          else hidePicker();
        }, 50);
      } else {
        hidePicker();
      }
    },
    true
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (!e.isTrusted) return;

      const target = e.target;
      const isInput = target && (target.isContentEditable || target.getAttribute("contenteditable") === "true");
      if (!isInput) return;

      // 1. Navigation when picker is open
      if (pickerElem && pickerElem.style.display !== "none" && activeCandidates.length > 0) {
        if (e.key === "ArrowRight" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          selectedIndex = (selectedIndex + 1) % activeCandidates.length;
          renderPicker();
          return;
        }

        if (e.key === "ArrowLeft") {
          e.preventDefault();
          e.stopPropagation();
          selectedIndex = (selectedIndex - 1 + activeCandidates.length) % activeCandidates.length;
          renderPicker();
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          hidePicker();
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commitSelection(selectedIndex);
          return;
        }
      }

      // 2. Direct Enter on .tag trigger
      if (e.key === "Enter") {
        const clean = cleanInputText(target.textContent);
        const match = clean.match(/^\.([a-zA-Z0-9_-]+)$/);

        if (match) {
          const query = match[1];
          if (activeCandidates.length > 0 && activeQuery === query) {
            e.preventDefault();
            e.stopPropagation();
            commitSelection(selectedIndex);
            return;
          }
        }
      }
    },
    true
  );

  console.log("[Sti-Key] Tampermonkey / Violentmonkey Userscript initialized.");
})();
