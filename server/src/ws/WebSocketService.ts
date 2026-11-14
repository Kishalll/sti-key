import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import { StickerRecord } from "../types/index.js";

export type WhatsAppStatus = "disconnected" | "qr_ready" | "connected";

export interface ToastPayload {
  status: "success" | "error";
  message: string;
  tag?: string;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private currentStatus: WhatsAppStatus = "disconnected";
  private currentQrDataUrl: string | null = null;

  public onPickerSelect?: (triggerId: string, stickerId: string) => void;
  public onPickerCancel?: (triggerId: string) => void;

  public attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on("connection", (ws: WebSocket) => {
      // Send initial status on connection
      ws.send(
        JSON.stringify({
          type: "WA_STATUS",
          status: this.currentStatus,
          qrDataUrl: this.currentQrDataUrl,
        })
      );

      ws.on("message", (raw: string | Buffer) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.type === "PICKER_SELECT" && data.triggerId && data.stickerId) {
            this.onPickerSelect?.(data.triggerId, data.stickerId);
          } else if (data.type === "PICKER_CANCEL" && data.triggerId) {
            this.onPickerCancel?.(data.triggerId);
          }
        } catch {
          // Ignore invalid client payloads
        }
      });
    });
  }

  public broadcast(data: any): void {
    if (!this.wss) return;
    const msg = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  public broadcastStatus(status: WhatsAppStatus, qrDataUrl: string | null): void {
    this.currentStatus = status;
    this.currentQrDataUrl = qrDataUrl;
    this.broadcast({
      type: "WA_STATUS",
      status,
      qrDataUrl,
    });
  }

  public broadcastPickerOpen(triggerId: string, query: string, candidates: StickerRecord[]): void {
    this.broadcast({
      type: "PICKER_OPEN",
      triggerId,
      query,
      candidates,
    });
  }

  public broadcastPickerClose(triggerId: string): void {
    this.broadcast({
      type: "PICKER_CLOSE",
      triggerId,
    });
  }

  public broadcastToast(toast: ToastPayload): void {
    this.broadcast({
      type: "TOAST_NOTIFY",
      status: toast.status,
      message: toast.message,
      tag: toast.tag,
    });
  }

  public getStatus(): { status: WhatsAppStatus; qrDataUrl: string | null } {
    return {
      status: this.currentStatus,
      qrDataUrl: this.currentQrDataUrl,
    };
  }
}

export const wsService = new WebSocketService();
