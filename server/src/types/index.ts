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

export interface CommitStagedOptions {
  stagedId: string;
  tag?: string;
  mode?: "fit" | "crop";
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  startTime?: number;
  duration?: number;
}
