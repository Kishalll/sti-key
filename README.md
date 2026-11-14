# Sti-Key: WhatsApp Sticker Manager and Companion Engine

[![Runtime: Node.js 22+](https://img.shields.io/badge/Runtime-Node.js_22+-339933.svg)](https://nodejs.org/)
[![Backend: Express](https://img.shields.io/badge/Backend-Express-000000.svg)](https://expressjs.com/)
[![Frontend: React + Vite](https://img.shields.io/badge/Frontend-React_19_%2B_Vite_6-61DAFB.svg)](https://vitejs.dev/)
[![Styling: Tailwind CSS](https://img.shields.io/badge/Styling-Tailwind_CSS_v4-38B2AC.svg)](https://tailwindcss.com/)
[![Database: SQLite WAL](https://img.shields.io/badge/Database-SQLite_WAL-003B57.svg)](https://sqlite.org/)
[![Engine: Baileys](https://img.shields.io/badge/WhatsApp-Baileys-25D366.svg)](https://github.com/WhiskeySockets/Baileys)
[![Media: Sharp + FFmpeg](https://img.shields.io/badge/Media-Sharp_%2B_FFmpeg-FF6600.svg)](https://sharp.pixelplumbing.com/)

> [🤝 **Architecture & Contributor Guide (`CONTRIBUTING.md`)**](CONTRIBUTING.md) &nbsp;|&nbsp; [📋 **Master Engineering Plan (`docs/plan.md`)**](docs/plan.md)

Sti-Key is a self-hosted desktop and web application that links to your WhatsApp account as a companion device. It indexes a local library of static and animated video stickers, automatically replaces `.tag` triggers in WhatsApp chats with native floating stickers, and lets you save new stickers directly from chats by replying with `.save`.

---

## Key Features

- **Zero Disk Scans on Chat Messages:** All tag queries evaluate in sub-millisecond time against a synchronized in-memory RAM index. Chat traffic never triggers SQLite queries or file scans.
- **True Native Stickers:** All outgoing media is formatted as valid 512x512 WebP buffers (up to 100 KB for static picture stickers; up to 500 KB and 10 seconds maximum for animated video stickers) and sent through WhatsApp's native sticker payload.
- **In-Chat Sticker Saver (`.save`):** Reply with `.save` or `.save <tag>` to any sticker someone sends in chat. The bot saves and indexes it immediately, assigns sequential default names (`untitled1`, `untitled2`) if no tag is provided, deletes your command text from chat, and pushes a real-time notification popup to your screen.
- **Interactive Floating Picker:** When multiple stickers share a tag (or match as prefixes/substrings), a keyboard and mouse picker overlay opens instantly via WebSocket. Navigate with Arrow keys, Tab, or mouse, and press Enter to send.
- **Preserved Quoted Context:** If you swipe-to-reply to someone's message when typing `.tag`, the resulting sticker lands as a direct quoted reply to that person.
- **Bulk Archive Importer:** Drag and drop `.zip` or `.wastickers` archives. Unpack files into a flashcard review queue with live similarity suggestions and three filter modes (`stickers_only`, `media_only`, and `both`).
- **Dynamic Bitrate Formula:** Animated stickers dynamically calculate video bitrate based on trimmed duration, guaranteeing files land under WhatsApp's strict 500 KB limit.
- **Silent False-Trigger Ignore:** Messages like `...okay` or `.env` that do not match existing tags are left completely untouched in chat.

---

## Architecture Overview

```text
User sends ".cat" in WhatsApp
         │
         ▼
WhatsApp Companion Listener (Baileys)
         │
         ├── Filter: fromMe === true && text matches single dot
         │
         ▼
In-Memory RAM Index (TagIndexService)
         │
         ├── 0 Matches: Silently ignore. Leave text message intact.
         │
         ├── 1 Match (Fast Path):
         │     ├── Read 512x512 WebP buffer from disk
         │     ├── Send native sticker (attaching quoted context if present)
         │     └── Delete original ".cat" trigger message from chat
         │
         └── 2+ Matches (Interactive Picker Path):
               ├── Store PendingTrigger (chatJid, msgKey, quotedContext)
               ├── Emit "PICKER_OPEN" event over WebSocket (ws://localhost:3001)
               ├── User picks sticker via Keyboard (Arrow + Enter) or Mouse click
               ├── Send selected sticker with quoted context
               └── Delete original ".cat" trigger message from chat
```

### In-Chat Sticker Saver Workflow

```text
User replies ".save [tag]" to a sticker
         │
         ├── Filter: fromMe === true && quoted message contains sticker
         │
         ├── Delete ".save" message from chat immediately
         ├── Determine tag: use provided tag or auto-assign lowest unused "untitledN"
         ├── Download media buffer via Baileys downloadMediaMessage
         ├── Write directly to storage/stickers/<uuid>.webp (with Sharp / FFmpeg fallback)
         ├── Commit record to SQLite and update In-Memory RAM Index
         └── Emit "TOAST_NOTIFY" to UI: "Saved sticker as: <tag>"
```

---

## Directory Layout

```text
sti-key/
├── client/              # React 19 + Vite 6 + Tailwind CSS v4 dashboard
│   ├── src/
│   │   ├── components/  # Header, Library, Importer, WhatsApp, PickerOverlay, Toasts
│   │   ├── hooks/       # useWebSocket hook for real-time events
│   │   ├── types.ts     # TypeScript interface definitions
│   │   └── App.tsx      # Main application view
│   └── package.json
│
├── server/              # Express backend with WebSocket, Media Converter, Baileys
│   ├── src/
│   │   ├── db/          # SQLite schema running in WAL mode via node:sqlite
│   │   ├── services/    # TagIndexService, MediaConverterService, StagingService, WhatsAppService
│   │   ├── routes/      # REST API: /api/stickers, /api/staging, /api/whatsapp
│   │   ├── ws/          # WebSocketService for picker and toast notifications
│   │   └── index.ts     # Server entrypoint
│   ├── test/            # Unified test suite (phases 1, 2, 3, 4, 6)
│   └── package.json
│
├── extension/           # Cross-browser extension for WhatsApp Web (Chromium & Firefox)
│   ├── manifest.json    # Manifest V3 extension configuration
│   ├── content.js       # In-chat floating picker and direct dispatch interceptor
│   ├── content.css      # Dark glassmorphism overlay styles
│   └── icon.png         # Extension icon
│
├── userscript/          # Userscript alternative for Tampermonkey / Violentmonkey
│   └── sti-key.user.js  # Standalone in-chat picker script
│
├── storage/             # Runtime data (git-ignored)
│   ├── auth_info/       # Multi-file encrypted credentials for WhatsApp socket
│   ├── staging/         # Extracted temporary files from ZIP uploads
│   ├── stickers/        # Converted 512x512 WebP files (<uuid>.webp)
│   └── stickers.db      # SQLite database in WAL mode
│
├── docs/                # Project plans and specifications (git-ignored)
├── scripts/             # Concurrent development runner (scripts/dev.js)
├── package.json         # Root scripts (npm run dev, npm test, npm run build)
├── CONTRIBUTING.md      # Contributor and architecture guide
└── README.md
```

---

## Quickstart Guide

### Prerequisites
- Node.js 22.0.0 or higher
- FFmpeg installed and available on your system PATH

### Installation and Setup

1. Clone repository and install dependencies:
   ```bash
   git clone <repo-url> sti-key
   cd sti-key
   cd server && npm install
   cd ../client && npm install
   cd ..
   ```

2. Start the development environment:
   ```bash
   npm run dev
   ```
   This starts:
   - Backend REST and WebSocket server on `http://localhost:3001`
   - Frontend web dashboard on `http://localhost:5173`

3. Link your WhatsApp account:
   - Open `http://localhost:5173` in your browser.
   - Go to the **WhatsApp** tab.
   - Scan the displayed QR code with your phone (Settings > Linked Devices > Link a Device).
   - Once linked, the status pill turns green.

4. Install the WhatsApp Web Extension (Chromium & Firefox):
   - **For Chrome / Brave / Edge:**
     1. Open `chrome://extensions/` and toggle **Developer mode** on (top right).
     2. Click **Load unpacked** and select the `extension/` folder in this repository.
   - **For Firefox:**
     1. Open `about:debugging#/runtime/this-firefox`.
     2. Click **Load Temporary Add-on...** and select `extension/manifest.json`.
   - **Alternative (Userscript via Tampermonkey / Violentmonkey):**
     Open `userscript/sti-key.user.js` and install it directly into your userscript manager.

Once installed, open `web.whatsapp.com`. Whenever you type `.tag` (such as `.cat`), the floating sticker picker appears directly above your WhatsApp typing bar. Pressing Enter or clicking a sticker clears your input and dispatches the sticker directly into the active chat without ever posting or deleting text.

---

## Available Commands

From the project root:

| Command | Action |
| --- | --- |
| `npm run dev` | Concurrently launches backend server and frontend Vite dashboard. |
| `npm test` | Runs the complete unified verification test suite across all subsystems. |
| `npm run build` | Compiles TypeScript for backend and builds production assets for frontend. |
| `npm run dev:server` | Runs backend server only with live TypeScript reloading (`tsx`). |
| `npm run dev:client` | Runs frontend Vite dev server only. |

---

## REST and WebSocket API Reference

The backend server exposes these endpoints:

| Endpoint | Method | Payload / Query | Description |
| --- | --- | --- | --- |
| `/api/stickers` | `GET` | `?search=<query>` | Returns stickers matching query (or all stickers) with statistics. |
| `/api/stickers/upload` | `POST` | `multipart/form-data` | Converts uploaded media to 512x512 WebP and stores in library. |
| `/api/stickers/:id` | `PATCH` | `{ tag: string }` | Renames an existing sticker tag. |
| `/api/stickers/:id` | `DELETE` | URL param `:id` | Deletes sticker file and database record. |
| `/api/staging/upload-zip` | `POST` | `multipart/form-data` | Unpacks `.zip` / `.wastickers` archive to temporary staging folder. |
| `/api/staging/commit` | `POST` | JSON options | Converts and commits a staged item to the permanent library. |
| `/api/staging/:stagedId` | `DELETE` | URL param `:stagedId` | Discards and deletes a temporary staged file. |
| `/api/whatsapp/status` | `GET` | None | Returns companion status and QR data URL. |
| `/api/whatsapp/connect` | `POST` | None | Triggers WhatsApp companion socket connection. |
| `/api/whatsapp/logout` | `POST` | None | Unlinks companion device and clears credentials. |

### WebSocket Events (`ws://localhost:3001`)

- `WA_STATUS`: Broadcasts `{ status: "disconnected" | "qr_ready" | "connected", qrDataUrl: string | null }`.
- `PICKER_OPEN`: Pushes candidates list when a multi-match `.tag` trigger fires.
- `PICKER_SELECT`: Sent by UI client when user selects a sticker by keyboard or mouse.
- `PICKER_CANCEL`: Sent by UI client on Escape or 30-second timeout.
- `TOAST_NOTIFY`: Real-time notification for `.save` events (`"Saved sticker as: <tag>"` or `"Unable to save sticker"`).

---

## Testing and Verification

Run the test suite from the project root:

```bash
npm test
```

The test runner executes five sequential verification suites:
1. `test:phase1`: SQLite database schema, WAL mode, RAM index, and three-tier similarity ranking.
2. `test:phase2`: Sharp static conversion (under 100 KB) and FFmpeg animated conversion (under 500 KB, 15 fps, 512x512).
3. `test:phase3`: REST API routes, file uploads, archive unpacking, and staging queue.
4. `test:phase4`: WhatsApp Baileys message parser, quoted context builder, `.save` parser, and WebSocket events.
5. `test:phase6`: End-to-end integration covering archive import, fast path, interactive picker selection, and `.save` auto-naming.
