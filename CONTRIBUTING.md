# Sti-Key Contributor and Architecture Guide

This document covers the internal architecture, data structures, mathematical formulas, protocol guidelines, testing requirements, and contribution standards for Sti-Key.

---

## 1. System Architecture

Sti-Key couples a Node.js Express TypeScript backend with a React Vite Tailwind frontend, communicating with WhatsApp via `@whiskeysockets/baileys` as a linked companion device.

```text
Incoming / Outgoing WhatsApp Event
               │
               ▼
Baileys Listener (messages.upsert)
               │
               ├── Filter 1: msg.key.fromMe === true (Ignore messages from others)
               ├── Filter 2: Extract text from conversation or extendedTextMessage
               ├── Filter 3: Check regex triggers
               │
               ├── Trigger A: ^\.save(?:\s+([a-zA-Z0-9_-]+))?$
               │     ├── Must quote a sticker message
               │     ├── Delete ".save" message from chat immediately
               │     ├── Assign tag (custom name or lowest unused "untitledN")
               │     ├── Download media buffer via downloadMediaMessage
               │     ├── Save to storage/stickers/<uuid>.webp
               │     ├── Write-through sync to SQLite and RAM index
               │     └── Emit TOAST_NOTIFY event over WebSocket
               │
               └── Trigger B: ^\.([a-zA-Z0-9_-]+)$
                     │
                     ▼
             TagIndexService (In-Memory RAM Index)
                     │
                     ├── 0 Matches: Silent ignore. Leave text untouched.
                     │
                     ├── 1 Match (Fast Path):
                     │     ├── Load 512x512 WebP buffer from storage/stickers/
                     │     ├── Reconstruct quoted reply context if present
                     │     ├── Send native sticker via sock.sendMessage
                     │     └── Delete original trigger message from chat
                     │
                     └── 2+ Matches (Interactive Picker):
                           ├── Cache PendingTrigger with 30s timeout
                           ├── Emit PICKER_OPEN over WebSocket
                           ├── User selects candidate via Keyboard or Mouse
                           ├── Receive PICKER_SELECT event
                           ├── Send selected sticker with quoted context
                           └── Delete original trigger message from chat
```

---

## 2. In-Memory RAM Index Specification

To satisfy the zero disk scans rule, lookups never touch the file system or run SQL `SELECT` queries during message handling.

### Data Structures (`server/src/services/TagIndexService.ts`)
- `idMap`: `Map<string, StickerRecord>` (Primary key lookups)
- `exactTagMap`: `Map<string, StickerRecord[]>` (Tag lookups, tags are non-unique)

### Three-Tier Similarity Search Algorithm
When a search query is submitted (e.g., `cat`):
1. **Tier 1 (Exact Match):** Records where `record.tag === query` (e.g., `cat`).
2. **Tier 2 (Prefix Match):** Records where `record.tag.startsWith(query)` and `record.tag !== query` (e.g., `cat_dance`, `cat_cry`).
3. **Tier 3 (Substring Match):** Records where `record.tag.includes(query)` elsewhere in the string (e.g., `my_cat`, `cool_cat_vibe`).

Results are deduplicated by sticker id while strictly preserving tier ranking.

### Write-Through Synchronization
Every mutation (insert, rename, delete) must execute against SQLite first and update the in-memory maps in place before returning.

---

## 3. Media Processing and Mathematical Formulas

All media files must be converted into 512x512 WebP before entering `storage/stickers/`.

### 3.1 Scaling Math for User-Controlled Fit vs Crop

#### Mode A: `fit` (Containment on Transparent Canvas)
The entire rectangular source image or video is preserved without cutting off any edges.
1. Calculate scale factor so the longest side becomes 512 pixels:
   `scaleFactor = 512 / Math.max(sourceWidth, sourceHeight)`
2. Scale the shorter side by the same factor and round to nearest whole pixel.
3. Calculate remaining padding needed to reach 512 pixels and split evenly between sides.
4. Center the scaled content inside a transparent 512x512 RGBA canvas.

#### Mode B: `crop` (User-Selected Region)
1. Clamp `cropX` and `cropY` so they are never less than 0.
2. Ensure `cropX + cropWidth` is at most the source media's natural width, and `cropY + cropHeight` is at most natural height.
3. Extract the sub-rectangle `(cropX, cropY, cropWidth, cropHeight)` first, and then resize that rectangle directly to 512x512.

### 3.2 Static Picture Sticker Pipeline (`sharp`)
- Output format: WebP, quality 80, alpha quality 80, effort 4.
- Size ceiling loop: If the output byte length exceeds 102,400 bytes (100 KB), loop reducing quality by 15 (minimum quality 20) until size is at most 100 KB.

### 3.3 Animated Video and GIF Pipeline (`fluent-ffmpeg`)
- Duration is clamped between 0.5 and 10.0 seconds.
- Dynamic bitrate formula:
  To keep output files under the 500 KB ceiling, set a safe payload ceiling of 440 KB (leaving 60 KB safety buffer for WebP container overhead):
  `targetKbps = Math.floor((440 * 8) / duration)`
  - Example for 8-second clip: `(440 * 8) / 8 = 440 kbps`.
  - Example for 10-second clip: `(440 * 8) / 10 = 352 kbps`.
- FFmpeg parameters:
  `-vcodec libwebp -an -r 15 -loop 0 -compression_level 6 -q:v 50 -preset default -b:v <targetKbps>k`
- Fallback retry rule: If the output file exceeds 500,000 bytes, re-encode with `fps=10` and `-q:v 30`.

---

## 4. WhatsApp Protocol Guidelines

When working with `@whiskeysockets/baileys`:

1. **Extracting Text Across Protobuf Wrappers:**
   Plain text is stored differently depending on whether the user sent a standalone message or replied to someone:
   `const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").trim();`

2. **Preserving Quoted Context:**
   Inspect `msg.message?.extendedTextMessage?.contextInfo`. If `stanzaId` and `quotedMessage` exist, reconstruct the quoted message object:
   ```typescript
   const quotedOption = {
     quoted: {
       key: {
         remoteJid: msg.key.remoteJid,
         id: contextInfo.stanzaId,
         participant: contextInfo.participant,
       },
       message: contextInfo.quotedMessage,
     },
   };
   ```

3. **Order of Operations on Dispatch:**
   Always send the sticker with the `quoted` option first, await the send confirmation, and only then delete the user's `.tag` trigger message using `await sock.sendMessage(chatJid, { delete: msg.key })`. Deleting the text first causes client scroll jumps on mobile devices.

---

## 5. In-Chat Sticker Saver (`.save`)

### Trigger Rule
- Matches regex: `^\.save(?:\s+([a-zA-Z0-9_-]+))?$`
- Must quote a message containing `stickerMessage`.
- Must have `fromMe: true`.

### Tag Assignment
- If tag is provided (e.g., `.save cool_cat`), normalize to trimmed lowercase with underscores.
- If tag is omitted (bare `.save`), call `tagIndex.getNextUntitledTag()` which checks memory and returns the lowest unused default name (`untitled1`, `untitled2`, etc.).

### Message Deletion and Feedback
- Delete the `.save` command message immediately so it acts as an invisible local trigger.
- Download media buffer via `downloadMediaMessage`.
- Save buffer to `storage/stickers/<uuid>.webp` and index in SQLite and RAM index.
- Broadcast `TOAST_NOTIFY` over WebSocket to render a desktop popup notification ("Saved sticker as: <tag>" or "Unable to save sticker").

---

## 6. Directory Layout and Module Inventory

```text
sti-key/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx           # Navigation and connection status pill
│   │   │   ├── LibraryTab.tsx       # Sticker search, stats, inline rename, delete
│   │   │   ├── ImporterTab.tsx      # Archive uploader, flashcard queue, similarity strip
│   │   │   ├── WhatsAppTab.tsx      # QR code pairing and unlink controls
│   │   │   ├── PickerOverlay.tsx    # Keyboard and mouse multi-match selector
│   │   │   └── ToastContainer.tsx   # Real-time .save notification toasts
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts      # WebSocket connection and event dispatch
│   │   ├── types.ts                 # Client data models
│   │   ├── App.tsx                  # Main layout container
│   │   ├── main.tsx                 # React DOM root
│   │   └── index.css                # Tailwind CSS v4 entry
│   ├── package.json
│   └── vite.config.ts               # Proxy configuration for /api and /ws
│
├── server/
│   ├── src/
│   │   ├── db/
│   │   │   └── index.ts             # SQLite WAL database initialization via node:sqlite
│   │   ├── services/
│   │   │   ├── TagIndexService.ts   # In-memory RAM index with three-tier search
│   │   │   ├── MediaConverterService.ts # Sharp static and FFmpeg animated pipelines
│   │   │   ├── StagingService.ts    # ZIP archive extraction and staging queue
│   │   │   └── WhatsAppService.ts   # Baileys socket, .tag triggers, and .save saver
│   │   ├── routes/
│   │   │   ├── stickers.ts          # REST CRUD for stickers
│   │   │   ├── staging.ts           # REST endpoints for archive uploads and commits
│   │   │   └── whatsapp.ts          # REST endpoints for status and pairing
│   │   ├── ws/
│   │   │   └── WebSocketService.ts  # Real-time WebSocket server
│   │   ├── types/
│   │   │   └── index.ts             # Server data models
│   │   ├── app.ts                   # Express application setup
│   │   └── index.ts                 # Server entrypoint
│   ├── test/                        # Unified test suite
│   │   ├── phase1.test.ts           # Database and RAM index tests
│   │   ├── phase2.test.ts           # Media processing tests
│   │   ├── phase3.test.ts           # REST API and staging tests
│   │   ├── phase4.test.ts           # Baileys parser and WebSocket tests
│   │   └── phase6.test.ts           # End-to-end integration tests
│   └── package.json
│
├── storage/                         # Runtime storage (git-ignored)
│   ├── auth_info/                   # Baileys session credentials
│   ├── staging/                     # Extracted files from ZIP uploads
│   ├── stickers/                    # Converted 512x512 WebP files
│   └── stickers.db                  # SQLite database file
│
├── scripts/
│   └── dev.js                       # Concurrent runner for server and client
├── package.json                     # Root npm scripts
├── CONTRIBUTING.md                  # This file
└── README.md                        # Project overview
```

---

## 7. Testing Standards

All test files are centralized in `server/test/` and run against clean test states.

To execute tests:
```bash
npm test
```

When contributing code:
- New services or routes must include test cases in `server/test/`.
- Never commit tests that leave persistent mock records in the production database.
- Always verify all five test phases pass before submitting pull requests.

---

## 8. Pull Request Checklist

Before submitting a PR, verify:
- [ ] `npm test` runs and passes all test suites.
- [ ] `npm run build` succeeds for both backend and frontend without TypeScript errors.
- [ ] Zero disk scans on chat messages are preserved (only query `TagIndexService` during chat events).
- [ ] Native 512x512 WebP constraints are enforced (max 100 KB for static, max 500 KB for animated).
- [ ] Documentation and comments use clear, concise language and avoid em dashes.
