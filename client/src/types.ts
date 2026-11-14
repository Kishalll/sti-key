export interface StickerRecord {
  id: string;
  tag: string;
  file_path: string;
  is_animated: number;
  file_size: number;
  created_at: number;
}

export interface TagIndexStats {
  totalStickers: number;
  uniqueTags: number;
}

export interface StagedItem {
  id: string;
  sessionId: string;
  fileName: string;
  filePath: string;
  isAnimated: number;
  fileSize: number;
  suggestedTag: string;
}

export type WhatsAppStatus = "disconnected" | "qr_ready" | "connected";

export interface ActivePicker {
  triggerId: string;
  query: string;
  candidates: StickerRecord[];
}

export interface ToastMessage {
  id: string;
  status: "success" | "error";
  message: string;
  tag?: string;
}
