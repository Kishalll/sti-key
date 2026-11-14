import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  jidNormalizedUser,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { wsService } from "../ws/WebSocketService.js";
import { tagIndex } from "./TagIndexService.js";
import { mediaConverter } from "./MediaConverterService.js";
import { StickerRecord } from "../types/index.js";

export interface PendingTrigger {
  triggerId: string;
  msg: WAMessage;
  timer: NodeJS.Timeout;
  candidates: StickerRecord[];
}

export interface ParsedTrigger {
  type: "save" | "tag" | "ignore";
  tag?: string;
  quotedSticker?: boolean;
}

export class WhatsAppService {
  private sock: WASocket | null = null;
  private authDir: string;
  private stickersDir: string;
  private pendingTriggers = new Map<string, PendingTrigger>();
  private isConnecting = false;
  private knownChats = new Map<string, string>();
  private lastActiveJid: string | null = null;
  private recentMessagesMap = new Map<string, WAMessage>();

  constructor() {
    this.authDir = path.resolve(process.cwd(), "../storage/auth_info");
    this.stickersDir = path.resolve(process.cwd(), "../storage/stickers");

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
    if (!fs.existsSync(this.stickersDir)) {
      fs.mkdirSync(this.stickersDir, { recursive: true });
    }

    // Connect WebSocket listeners
    wsService.onPickerSelect = (triggerId, stickerId) => {
      this.handlePickerSelect(triggerId, stickerId);
    };
    wsService.onPickerCancel = (triggerId) => {
      this.handlePickerCancel(triggerId);
    };
  }

  public parseMessage(msg: WAMessage): ParsedTrigger {
    if (!msg.key.fromMe || !msg.message) {
      return { type: "ignore" };
    }

    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""
    ).trim();

    if (!text.startsWith(".")) {
      return { type: "ignore" };
    }

    // 1. Check for .save command
    const saveMatch = text.match(/^\.save(?:\s+([a-zA-Z0-9_-]+))?$/i);
    if (saveMatch) {
      const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
      const hasSticker = Boolean(quotedMsg?.stickerMessage);
      const tag = saveMatch[1]?.trim() || tagIndex.getNextUntitledTag();
      return {
        type: "save",
        tag: tagIndex.normalizeTag(tag),
        quotedSticker: hasSticker,
      };
    }

    // 2. Check for .tag trigger
    const tagMatch = text.match(/^\.([a-zA-Z0-9_-]+)$/);
    if (tagMatch) {
      return {
        type: "tag",
        tag: tagIndex.normalizeTag(tagMatch[1]),
      };
    }

    return { type: "ignore" };
  }

  public buildQuotedOption(msg: WAMessage): any {
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (contextInfo?.stanzaId && contextInfo?.quotedMessage) {
      return {
        quoted: {
          key: {
            remoteJid: msg.key.remoteJid,
            id: contextInfo.stanzaId,
            participant: contextInfo.participant,
          },
          message: contextInfo.quotedMessage,
        },
      };
    }
    return undefined;
  }

  public async refreshKnownGroups(): Promise<void> {
    if (!this.sock) return;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      for (const [jid, metadata] of Object.entries(groups)) {
        if (metadata.subject) {
          this.knownChats.set(jid, metadata.subject);
        }
      }
      console.log(`[WA SYNC] Cached ${Object.keys(groups).length} participating groups in memory`);
    } catch (err) {
      console.error("[WA SYNC ERROR] Failed to fetch participating groups:", err);
    }
  }

  public async connect(): Promise<void> {
    if (this.isConnecting || this.sock) return;
    this.isConnecting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          const qrDataUrl = await qrcode.toDataURL(qr);
          wsService.broadcastStatus("qr_ready", qrDataUrl);
        }

        if (connection === "open") {
          wsService.broadcastStatus("connected", null);
          this.refreshKnownGroups().catch(() => {});
        } else if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.sock = null;
          this.isConnecting = false;
          wsService.broadcastStatus("disconnected", null);

          if (shouldReconnect) {
            setTimeout(() => this.connect(), 3000);
          }
        }
      });

      this.sock.ev.on("chats.upsert", (chats) => {
        for (const chat of chats) {
          if (chat.id && chat.name) {
            this.knownChats.set(chat.id, chat.name);
          }
        }
      });

      this.sock.ev.on("contacts.upsert", (contacts) => {
        for (const contact of contacts) {
          if (contact.id && (contact.name || contact.notify)) {
            this.knownChats.set(contact.id, contact.name || contact.notify || "");
          }
        }
      });

      this.sock.ev.on("contacts.update", (updates) => {
        for (const update of updates) {
          if (update.id && (update.name || update.notify)) {
            this.knownChats.set(update.id, update.name || update.notify || "");
          }
        }
      });

      this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
        for (const msg of messages) {
          if (msg.key.id) {
            this.recentMessagesMap.set(msg.key.id, msg);
            if (this.recentMessagesMap.size > 2000) {
              const oldestKey = this.recentMessagesMap.keys().next().value;
              if (oldestKey) this.recentMessagesMap.delete(oldestKey);
            }
          }
          if (msg.key.remoteJid) {
            this.lastActiveJid = msg.key.remoteJid;
            if (msg.pushName) {
              this.knownChats.set(msg.key.remoteJid, msg.pushName);
            }
          }
        }

        if (type !== "notify") return;
        for (const msg of messages) {
          await this.handleMessage(msg);
        }
      });
    } catch (err) {
      console.error("WhatsApp connection error:", err);
      this.sock = null;
      this.isConnecting = false;
      wsService.broadcastStatus("disconnected", null);
    }
  }

  public async handleMessage(msg: WAMessage): Promise<void> {
    const parsed = this.parseMessage(msg);
    const chatJid = msg.key.remoteJid;
    const text = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      ""
    ).trim();

    if (text) {
      console.log(`[WA MSG DETECTED] chat: ${chatJid || "unknown"}, fromMe: ${msg.key.fromMe}, text: "${text}", parsedType: ${parsed.type}`);
    }

    if (parsed.type === "ignore") return;
    if (!chatJid) return;

    // Handle .save command
    if (parsed.type === "save") {
      if (!parsed.quotedSticker) {
        console.log(`[WA SAVE IGNORED] .save was sent but does not quote a sticker message`);
        return;
      }

      console.log(`[WA SAVE EXECUTING] Saving sticker with tag "${parsed.tag}" in chat ${chatJid}`);
      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      // Delete .save trigger message immediately from chat
      if (this.sock) {
        try {
          await this.sock.sendMessage(chatJid, { delete: msg.key });
          console.log(`[WA SAVE CLEANUP] Deleted .save trigger message from ${chatJid}`);
        } catch {
          // Ignored
        }
      }

      try {
        const buffer = (await downloadMediaMessage(
          { key: msg.key, message: quotedMsg },
          "buffer",
          {}
        )) as Buffer;

        if (!buffer || buffer.length === 0) {
          throw new Error("Empty media buffer received");
        }

        const stickerId = uuidv4();
        const relativeFileName = `${stickerId}.webp`;
        const outputPath = path.join(this.stickersDir, relativeFileName);

        await fs.promises.writeFile(outputPath, buffer);
        const stats = await fs.promises.stat(outputPath);
        const isAnim = (await mediaConverter.isAnimated(buffer)) ? 1 : 0;

        const record: StickerRecord = {
          id: stickerId,
          tag: parsed.tag!,
          file_path: relativeFileName,
          is_animated: isAnim,
          file_size: stats.size,
          created_at: Date.now(),
        };

        tagIndex.insert(record);
        wsService.broadcastToast({
          status: "success",
          message: `Saved sticker as: ${parsed.tag}`,
          tag: parsed.tag,
        });
      } catch (err) {
        console.error("Failed to save sticker from chat:", err);
        wsService.broadcastToast({
          status: "error",
          message: "Unable to save sticker",
        });
      }
      return;
    }

    // Handle .tag trigger from chat
    if (parsed.type === "tag" && parsed.tag) {
      const candidates = tagIndex.searchSimilar(parsed.tag);
      if (candidates.length === 0) {
        return;
      }

      // Fast path: send top candidate directly without dashboard popup
      await this.sendStickerAndCleanUp(msg, candidates[0]);
    }
  }

  public async sendStickerAndCleanUp(msg: WAMessage, sticker: StickerRecord): Promise<void> {
    if (!this.sock) return;

    const chatJid = msg.key.remoteJid;
    if (!chatJid) return;

    console.log(`[WA CHAT TRIGGER] .tag message intercepted: sending "${sticker.tag}" to ${chatJid} and deleting trigger text`);

    const stickerPath = path.join(this.stickersDir, sticker.file_path);
    if (!fs.existsSync(stickerPath)) return;

    const stickerBuffer = await fs.promises.readFile(stickerPath);
    const quotedOption = this.buildQuotedOption(msg);

    // Send sticker first
    await this.sock.sendMessage(chatJid, { sticker: stickerBuffer }, quotedOption);

    // Delete trigger message after send confirmation
    try {
      await this.sock.sendMessage(chatJid, { delete: msg.key });
      console.log(`[WA CHAT TRIGGER] Deleted original .tag text message in ${chatJid}`);
    } catch (err) {
      console.error(`[WA CHAT TRIGGER] Failed to delete trigger text message:`, err);
    }
  }

  public async handlePickerSelect(triggerId: string, stickerId: string): Promise<void> {
    const pending = this.pendingTriggers.get(triggerId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingTriggers.delete(triggerId);
    wsService.broadcastPickerClose(triggerId);

    const chosen = tagIndex.getById(stickerId);
    if (chosen) {
      console.log(`[WA PICKER SELECTED] User chose sticker "${chosen.tag}" from picker overlay`);
      await this.sendStickerAndCleanUp(pending.msg, chosen);
    }
  }

  public handlePickerCancel(triggerId: string): void {
    const pending = this.pendingTriggers.get(triggerId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingTriggers.delete(triggerId);
    wsService.broadcastPickerClose(triggerId);
    console.log(`[WA PICKER CANCELLED] User closed or timed out picker overlay`);
  }

  public async sendStickerDirect(params: {
    stickerId: string;
    chatJid?: string;
    chatTitle?: string;
    isSelfChat?: boolean;
    recentStanzaIds?: string[];
    quotedStanzaId?: string;
    quotedParticipant?: string;
    quotedFromMe?: boolean;
  }): Promise<boolean> {
    console.log(`[WA DIRECT SEND START] Dispatch request for sticker ${params.stickerId}:`, {
      chatJid: params.chatJid,
      chatTitle: params.chatTitle,
      isSelfChat: params.isSelfChat,
      recentStanzaIdsCount: params.recentStanzaIds?.length || 0,
      quotedStanzaId: params.quotedStanzaId,
    });

    if (!this.sock) {
      console.error(`[WA DIRECT SEND ERROR] WhatsApp companion socket is disconnected`);
      throw new Error("WhatsApp companion socket is not connected");
    }

    const sticker = tagIndex.getById(params.stickerId);
    if (!sticker) {
      console.error(`[WA DIRECT SEND ERROR] Sticker ${params.stickerId} not found in RAM index`);
      throw new Error(`Sticker not found: ${params.stickerId}`);
    }

    const stickerPath = path.join(this.stickersDir, sticker.file_path);
    if (!fs.existsSync(stickerPath)) {
      console.error(`[WA DIRECT SEND ERROR] Sticker file ${sticker.file_path} missing on disk`);
      throw new Error(`Sticker file missing from disk: ${sticker.file_path}`);
    }

    // Helper to get companion's own self JID
    const getSelfJid = (): string | null => {
      const raw = this.sock?.user?.id || (this.sock as any)?.authState?.creds?.me?.id;
      if (!raw) return null;
      try {
        return jidNormalizedUser(raw);
      } catch {
        return raw.split(":")[0] + "@s.whatsapp.net";
      }
    };

    // 1. Resolve target JID by direct JID if provided
    let targetJid = params.chatJid;

    // 2. Resolve self-chat (Message yourself / Note to Self / You)
    if (!targetJid) {
      const titleLower = (params.chatTitle || "").toLowerCase().trim();
      const meName = (this.sock?.user?.name || (this.sock as any)?.authState?.creds?.me?.name || "").toLowerCase().trim();
      const selfJid = getSelfJid();
      const myPhone = selfJid ? selfJid.replace(/@s\.whatsapp\.net$/, "") : "";

      if (
        params.isSelfChat === true ||
        titleLower.includes("message yourself") ||
        titleLower.includes("(you)") ||
        titleLower === "you" ||
        (meName && (titleLower === meName || titleLower.includes(meName))) ||
        (myPhone && titleLower.includes(myPhone))
      ) {
        targetJid = selfJid || undefined;
        if (targetJid) {
          console.log(`[WA DIRECT SEND SUCCESS] Matched self-chat JID ${targetJid} from title "${params.chatTitle}"`);
        }
      }
    }

    // 3. Resolve target JID by matching message stanza IDs in the chat pane
    if (!targetJid && params.recentStanzaIds && Array.isArray(params.recentStanzaIds)) {
      for (let i = params.recentStanzaIds.length - 1; i >= 0; i--) {
        const stanzaId = params.recentStanzaIds[i];
        if (this.recentMessagesMap.has(stanzaId)) {
          const matchedMsg = this.recentMessagesMap.get(stanzaId);
          if (matchedMsg?.key.remoteJid) {
            targetJid = matchedMsg.key.remoteJid;
            console.log(`[WA DIRECT SEND SUCCESS] Matched destination JID ${targetJid} from active stanzaId ${stanzaId}`);
            break;
          }
        }
      }
    }

    // 4. Resolve target JID by matching chat title against cached groups and contacts
    if (!targetJid && params.chatTitle) {
      const searchTitle = params.chatTitle.toLowerCase().trim();
      // Exact title match first
      for (const [jid, title] of this.knownChats.entries()) {
        const cleanTitle = title.toLowerCase().trim();
        if (cleanTitle === searchTitle) {
          targetJid = jid;
          console.log(`[WA DIRECT SEND SUCCESS] Exact match JID ${targetJid} ("${title}") from chat title "${params.chatTitle}"`);
          break;
        }
      }
      // Substring match fallback
      if (!targetJid) {
        for (const [jid, title] of this.knownChats.entries()) {
          const cleanTitle = title.toLowerCase().trim();
          if (
            (cleanTitle.length >= 3 && searchTitle.includes(cleanTitle)) ||
            (searchTitle.length >= 3 && cleanTitle.includes(searchTitle))
          ) {
            targetJid = jid;
            console.log(`[WA DIRECT SEND SUCCESS] Substring match JID ${targetJid} ("${title}") from chat title "${params.chatTitle}"`);
            break;
          }
        }
      }
    }

    if (!targetJid) {
      console.error(`[WA DIRECT SEND ERROR] Destination chat JID could not be resolved`);
      throw new Error("Destination chat JID could not be resolved. Please click in the chat conversation.");
    }

    const stickerBuffer = await fs.promises.readFile(stickerPath);

    let sendOptions: any = undefined;
    if (params.quotedStanzaId && this.recentMessagesMap.has(params.quotedStanzaId)) {
      const quotedMsg = this.recentMessagesMap.get(params.quotedStanzaId);
      sendOptions = { quoted: quotedMsg };
    }

    await this.sock.sendMessage(targetJid, { sticker: stickerBuffer }, sendOptions);
    console.log(
      `[WA DIRECT SEND SUCCESS] Sent "${sticker.tag}" directly to ${targetJid}${
        sendOptions ? " with quoted reply" : ""
      }`
    );
    return true;
  }

  public async sendDirectSticker(chatJid: string, stickerId: string): Promise<boolean> {
    return this.sendStickerDirect({ stickerId, chatJid });
  }

  public async logout(): Promise<void> {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
      fs.mkdirSync(this.authDir, { recursive: true });
    }
    wsService.broadcastStatus("disconnected", null);
  }
}

export const whatsAppService = new WhatsAppService();
