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
