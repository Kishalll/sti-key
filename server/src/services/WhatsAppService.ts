import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
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

      this.sock.ev.on("messages.upsert", async ({ messages, type }) => {
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
    if (parsed.type === "ignore") return;

    const chatJid = msg.key.remoteJid;
    if (!chatJid) return;

    // Handle .save command
    if (parsed.type === "save") {
      if (!parsed.quotedSticker) return;

      const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      // Delete .save trigger message immediately from chat
      if (this.sock) {
        try {
          await this.sock.sendMessage(chatJid, { delete: msg.key });
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

    // Handle .tag trigger
    if (parsed.type === "tag" && parsed.tag) {
      const candidates = tagIndex.searchSimilar(parsed.tag);
      if (candidates.length === 0) {
        // Silent false-trigger ignore
        return;
      }

      if (candidates.length === 1) {
        // Fast path
        await this.sendStickerAndCleanUp(msg, candidates[0]);
      } else {
        // Multi-match interactive picker path
        const triggerId = uuidv4();
        const timer = setTimeout(() => {
          this.pendingTriggers.delete(triggerId);
          wsService.broadcastPickerClose(triggerId);
        }, 30000);

        this.pendingTriggers.set(triggerId, {
          triggerId,
          msg,
          timer,
          candidates,
        });

        wsService.broadcastPickerOpen(triggerId, parsed.tag, candidates);
      }
    }
  }

  public async sendStickerAndCleanUp(msg: WAMessage, sticker: StickerRecord): Promise<void> {
    if (!this.sock) return;

    const chatJid = msg.key.remoteJid;
    if (!chatJid) return;

    const stickerPath = path.join(this.stickersDir, sticker.file_path);
    if (!fs.existsSync(stickerPath)) return;

    const stickerBuffer = await fs.promises.readFile(stickerPath);
    const quotedOption = this.buildQuotedOption(msg);

    // Send sticker first
    await this.sock.sendMessage(chatJid, { sticker: stickerBuffer }, quotedOption);

    // Delete trigger message after send confirmation
    try {
      await this.sock.sendMessage(chatJid, { delete: msg.key });
    } catch {
      // Ignored
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
      await this.sendStickerAndCleanUp(pending.msg, chosen);
    }
  }

  public handlePickerCancel(triggerId: string): void {
    const pending = this.pendingTriggers.get(triggerId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingTriggers.delete(triggerId);
    wsService.broadcastPickerClose(triggerId);
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
