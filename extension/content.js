(function () {
  const extensionApi = typeof chrome !== "undefined" ? chrome : browser;
  let activeCandidates = [];
  let selectedIndex = 0;
  let pickerElem = null;
  let activeQuery = "";
  let debounceTimer = null;
  let isPickerOpen = false;
  let lastInteractedDataId = null;

  function cleanInputText(str) {
    if (!str) return "";
    return str.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  }

  function extractJid(dataId) {
    if (!dataId) return null;
    const parts = dataId.split("_");
    for (const part of parts) {
      if (
        part.includes("@g.us") ||
        part.includes("@s.whatsapp.net") ||
        part.includes("@c.us") ||
        part.includes("@lid")
      ) {
        const clean = part.replace(/^_+|_+$/g, "");
        return clean.replace(/@c\.us$/i, "@s.whatsapp.net");
      }
    }
    return null;
  }

  function getChatInput() {
    return (
      document.querySelector("#main footer div[contenteditable='true'][role='textbox']") ||
      document.querySelector("#main footer div[contenteditable='true']") ||
      document.querySelector("footer div[contenteditable='true']")
    );
  }

  function getActiveChatContext() {
    let chatJid = null;

    // 1. Collect message stanza IDs from active chat pane
    const recentStanzaIds = Array.from(document.querySelectorAll("#main [data-id]"))
      .slice(-25)
      .map((el) => el.getAttribute("data-id"))
      .filter(Boolean);

    // 2. Scan elements for direct JID string
    const messageContainers = document.querySelectorAll(
      "#main [data-id*='@'], [data-id*='@'], [data-jid*='@']"
    );
    for (let i = messageContainers.length - 1; i >= 0; i--) {
      const dataId = messageContainers[i].getAttribute("data-id") || messageContainers[i].getAttribute("data-jid");
      const jid = extractJid(dataId);
      if (jid) {
        chatJid = jid;
        break;
      }
    }

    // 3. Scan last user clicked message element
    if (!chatJid && lastInteractedDataId) {
      chatJid = extractJid(lastInteractedDataId);
    }

    // 4. Scan active conversation in sidebar
    if (!chatJid) {
      const activeChatItem = document.querySelector(
        "#pane-side [aria-selected='true'], div[role='row'][aria-selected='true'], [aria-selected='true']"
      );
      if (activeChatItem) {
        const dataId = activeChatItem.getAttribute("data-id") || activeChatItem.querySelector("[data-id]")?.getAttribute("data-id");
        if (dataId) {
          chatJid = extractJid(dataId);
        }
        if (!chatJid) {
          const sideImg = activeChatItem.querySelector("img[src*='u=']");
          if (sideImg) {
            const src = sideImg.getAttribute("src") || "";
            const uMatch = src.match(/u=([0-9\-_]+%40[a-zA-Z0-9\._-]+|[0-9\-_]+@[a-zA-Z0-9\._-]+)/);
            if (uMatch) {
              const rawJid = decodeURIComponent(uMatch[1]);
              chatJid = rawJid.replace(/@c\.us$/i, "@s.whatsapp.net");
            }
          }
        }
      }
    }

    // 5. Target active conversation header specifically inside #main
    const mainHeader = document.querySelector("#main header");
    let chatTitle = null;
    let isSelfChat = false;

    if (mainHeader) {
      const headerText = mainHeader.innerText || "";
      if (
        headerText.includes("Message yourself") ||
        headerText.includes("(You)") ||
        headerText.toLowerCase().includes("message yourself")
      ) {
        isSelfChat = true;
        chatTitle = "Message yourself";
      }

      if (!chatTitle) {
        const titleEl = mainHeader.querySelector("span[title]");
        chatTitle = titleEl?.getAttribute("title") || titleEl?.textContent?.trim() || null;
      }

      if (!chatTitle) {
        const spans = Array.from(mainHeader.querySelectorAll("span[dir='auto']"));
        for (const span of spans) {
          const t = span.textContent?.trim();
          if (
            t &&
            t.length > 0 &&
            !/^(online|typing\.\.\.|click here|last seen)/i.test(t)
          ) {
            chatTitle = t;
            break;
          }
        }
      }

      if (!chatJid) {
        const avatarImg = mainHeader.querySelector("img[src*='u=']");
        if (avatarImg) {
          const src = avatarImg.getAttribute("src") || "";
          const uMatch = src.match(/u=([0-9\-_]+%40[a-zA-Z0-9\._-]+|[0-9\-_]+@[a-zA-Z0-9\._-]+)/);
          if (uMatch) {
            const rawJid = decodeURIComponent(uMatch[1]);
            chatJid = rawJid.replace(/@c\.us$/i, "@s.whatsapp.net");
          }
        }
      }

      if (!chatJid && chatTitle && /^\+?[0-9\s-]+$/.test(chatTitle)) {
        const cleanPhone = chatTitle.replace(/[^0-9]/g, "");
        if (cleanPhone.length >= 7) {
          chatJid = `${cleanPhone}@s.whatsapp.net`;
        }
      }
    }

    // Quoted reply context
    const replyPreview = document.querySelector(
      "#main footer [data-testid='quoted-message'], #main footer div[role='region'], #main footer [data-testid='reply-preview'], footer [data-testid='quoted-message']"
    );

    let quotedStanzaId = undefined;
    let quotedParticipant = undefined;
    let quotedFromMe = undefined;

    if (replyPreview && lastInteractedDataId) {
      const parts = lastInteractedDataId.split("_");
      if (parts.length >= 3) {
        quotedFromMe = parts[0] === "true";
        quotedStanzaId = parts[2];
        if (parts.length > 3) {
          quotedParticipant = parts[3];
        }
      }
    }

    return {
      chatJid,
      chatTitle,
      isSelfChat,
      recentStanzaIds,
      quotedStanzaId,
      quotedParticipant,
      quotedFromMe,
      hasReplyPreview: Boolean(replyPreview),
    };
  }

  function reportDomDiagnostics() {
    try {
      const allDataIds = Array.from(document.querySelectorAll("#main [data-id], [data-id]"))
        .slice(-15)
        .map((el) => el.getAttribute("data-id"));

      const headerEl = document.querySelector("#main header");
      const headerSummary = headerEl ? {
        title: headerEl.innerText?.slice(0, 150),
        imgSrc: headerEl.querySelector("img")?.getAttribute("src")?.slice(0, 150),
      } : "NO_MAIN_HEADER";

      const mainEl = document.querySelector("#main");
      const footerEl = document.querySelector("#main footer, footer");

      const diagData = {
        timestamp: Date.now(),
        mainExists: Boolean(mainEl),
        footerExists: Boolean(footerEl),
        dataIdCount: document.querySelectorAll("#main [data-id]").length,
        recentDataIds: allDataIds,
        headerSummary,
      };

      console.log("[Sti-Key DOM Diagnostics]:", diagData);
      extensionApi.runtime.sendMessage({
        type: "DEBUG_DOM",
        data: diagData,
      });
    } catch (err) {
      console.error("[Sti-Key DOM Diagnostics Error]:", err);
    }
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
        <div class="stikey-hint">Enter / Tab to send · Arrows to navigate · Esc to close</div>
      </div>
      <div class="stikey-candidates-row">
        ${activeCandidates
          .map(
            (stk, idx) => `
          <div class="stikey-card ${idx === selectedIndex ? "stikey-selected" : ""}" data-index="${idx}">
            <img src="${stk.dataUrl || stk.file_path}" alt="${stk.tag}" class="stikey-img" />
            <span class="stikey-tag-label">.${stk.tag}</span>
          </div>
        `
          )
          .join("")}
      </div>
    `;

    pickerElem.style.display = "block";
    isPickerOpen = true;

    // Report live DOM diagnostic snapshot to server
    reportDomDiagnostics();

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
    isPickerOpen = false;
    activeCandidates = [];
    selectedIndex = 0;
    activeQuery = "";
  }

  function clearWhatsAppInput(inputEl) {
    if (!inputEl) return;
    inputEl.focus();

    try {
      const range = document.createRange();
      range.selectNodeContents(inputEl);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand("delete", false, null);
    } catch {
      inputEl.textContent = "";
    }

    const remaining = cleanInputText(inputEl.innerText || inputEl.textContent || "");
    if (remaining.length > 0) {
      inputEl.textContent = "";
      inputEl.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        })
      );
    }
  }

  function closeReplyPreviewIfOpen() {
    const closeBtn = document.querySelector(
      "#main footer [data-testid='cancel-reply'], #main footer button span[data-icon='x'], #main footer span[data-icon='x'], footer [data-testid='cancel-reply']"
    );
    if (closeBtn) {
      const clickable = closeBtn.closest("button") || closeBtn;
      clickable.click();
    }
  }

  function searchStickers(query) {
    return new Promise((resolve) => {
      extensionApi.runtime.sendMessage(
        { type: "SEARCH_STICKERS", query },
        (response) => {
          if (response && response.success) {
            resolve(response.stickers || []);
          } else {
            resolve([]);
          }
        }
      );
    });
  }

  async function commitSelection(idx) {
    const chosen = activeCandidates[idx];
    if (!chosen) {
      hidePicker();
      return;
    }

    const inputEl = getChatInput();
    const ctx = getActiveChatContext();
    console.log("[Sti-Key] Committing sticker selection:", {
      tag: chosen.tag,
      id: chosen.id,
      ctx,
    });

    const hasAnyIdentifier = Boolean(
      ctx.chatJid ||
      ctx.chatTitle ||
      ctx.isSelfChat ||
      (ctx.recentStanzaIds && ctx.recentStanzaIds.length > 0)
    );

    if (!hasAnyIdentifier) {
      console.warn("[Sti-Key] No destination chat detected. Aborting dispatch.");
      const hint = pickerElem?.querySelector(".stikey-hint");
      if (hint) {
        hint.textContent = "Chat not detected. Click anywhere in chat messages to focus.";
        hint.style.color = "#f87171";
      }
      return;
    }

    clearWhatsAppInput(inputEl);
    hidePicker();

    if (ctx.hasReplyPreview) {
      setTimeout(() => closeReplyPreviewIfOpen(), 60);
    }

    extensionApi.runtime.sendMessage(
      {
        type: "SEND_STICKER_DIRECT",
        stickerId: chosen.id,
        chatJid: ctx.chatJid,
        chatTitle: ctx.chatTitle,
        isSelfChat: ctx.isSelfChat,
        recentStanzaIds: ctx.recentStanzaIds,
        quotedStanzaId: ctx.quotedStanzaId,
        quotedParticipant: ctx.quotedParticipant,
        quotedFromMe: ctx.quotedFromMe,
      },
      (response) => {
        console.log("[Sti-Key] Direct dispatch response:", response);
      }
    );
  }

  // Track user clicks on message elements to capture quoted reply and chat context
  document.addEventListener(
    "mousedown",
    (e) => {
      const msgElem = e.target.closest("#main [data-id], [data-id]");
      if (msgElem) {
        lastInteractedDataId = msgElem.getAttribute("data-id");
      }
    },
    true
  );

  // Live input monitoring for as-you-type autocomplete
  document.addEventListener(
    "input",
    (e) => {
      if (!e.isTrusted) return;

      const target = e.target;
      if (!target || !(target.isContentEditable || target.getAttribute("contenteditable") === "true")) {
        return;
      }

      const text = cleanInputText(target.innerText || target.textContent || "");
      const match = text.match(/^\.([a-zA-Z0-9_-]{1,32})$/);

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
        }, 40);
      } else {
        hidePicker();
      }
    },
    true
  );

  // Pre-send capture-phase keyboard interception
  window.addEventListener(
    "keydown",
    (e) => {
      if (!isPickerOpen || activeCandidates.length === 0) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        selectedIndex = (selectedIndex + 1) % activeCandidates.length;
        renderPicker();
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        selectedIndex = (selectedIndex - 1 + activeCandidates.length) % activeCandidates.length;
        renderPicker();
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        hidePicker();
        return;
      }

      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        commitSelection(selectedIndex);
        return;
      }
    },
    true
  );

  console.log("[Sti-Key] WhatsApp Web Live Autocomplete Extension initialized.");
})();
