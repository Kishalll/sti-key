(function () {
  const SERVER_URL = "http://localhost:3001";
  let activeCandidates = [];
  let selectedIndex = 0;
  let pickerElem = null;
  let activeQuery = "";
  let debounceTimer = null;

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
    if (pickerElem) {
      pickerElem.style.display = "none";
    }
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
    console.log("[Sti-Key] Committing sticker selection:", {
      tag: chosen.tag,
      id: chosen.id,
      chatJid,
    });

    if (!chatJid) {
      console.warn("[Sti-Key] Could not detect active chat JID. Make sure a chat is open.");
      hidePicker();
      return;
    }

    clearActiveInput();
    hidePicker();

    try {
      const res = await fetch(`${SERVER_URL}/api/whatsapp/send-sticker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatJid,
          stickerId: chosen.id,
        }),
      });
      const data = await res.json();
      console.log("[Sti-Key] Server direct dispatch response:", data);
    } catch (err) {
      console.error("[Sti-Key] Failed to dispatch sticker directly:", err);
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

  // Intercept typing in message box
  document.addEventListener(
    "input",
    (e) => {
      if (!e.isTrusted) return;

      const target = e.target;
      if (!target || !(target.isContentEditable || target.getAttribute("contenteditable") === "true")) {
        return;
      }

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
          if (activeCandidates.length > 0) {
            renderPicker();
          } else {
            hidePicker();
          }
        }, 50);
      } else {
        hidePicker();
      }
    },
    true
  );

  // Synchronous Enter key interception to prevent message transmission
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

      // 2. Direct Enter on .tag text
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

  console.log("[Sti-Key] WhatsApp Web Companion Extension initialized.");
})();
