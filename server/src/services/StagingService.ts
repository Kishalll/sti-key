import AdmZip from "adm-zip";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { StagedItem, CommitStagedOptions, StickerRecord } from "../types/index.js";
import { mediaConverter } from "./MediaConverterService.js";
import { tagIndex } from "./TagIndexService.js";

export type FilterMode = "stickers_only" | "media_only" | "both";

export class StagingService {
  private stagingDir: string;
  private stickersDir: string;
  private stagedMap = new Map<string, StagedItem>();

  constructor() {
    this.stagingDir = path.resolve(process.cwd(), "../storage/staging");
    this.stickersDir = path.resolve(process.cwd(), "../storage/stickers");

    if (!fs.existsSync(this.stagingDir)) {
      fs.mkdirSync(this.stagingDir, { recursive: true });
    }
    if (!fs.existsSync(this.stickersDir)) {
      fs.mkdirSync(this.stickersDir, { recursive: true });
    }
  }

  public getStagedItem(id: string): StagedItem | undefined {
    return this.stagedMap.get(id);
  }

  private isGenericWhatsAppName(name: string): boolean {
    const base = path.parse(name).name;
    return /^(?:STK|IMG|VID)-\d{8}-WA\d+/i.test(base);
  }

  private sanitizeTag(name: string): string {
    const base = path.parse(name).name;
    return base.toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  }

  public async extractArchive(
    zipBufferOrPath: string | Buffer,
    filterMode: FilterMode = "stickers_only"
  ): Promise<{ sessionId: string; items: StagedItem[] }> {
    const sessionId = uuidv4();
    const sessionDir = path.join(this.stagingDir, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });

    const zip = new AdmZip(zipBufferOrPath);
    const entries = zip.getEntries();
    const items: StagedItem[] = [];

    const allowedStickers = new Set([".webp"]);
    const allowedMedia = new Set([".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webm"]);

    let itemIndex = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (entry.entryName.includes("__MACOSX") || entry.entryName.includes(".DS_Store")) {
        continue;
      }

      const ext = path.extname(entry.entryName).toLowerCase();
      let match = false;

      if (filterMode === "stickers_only" && allowedStickers.has(ext)) {
        match = true;
      } else if (filterMode === "media_only" && allowedMedia.has(ext)) {
        match = true;
      } else if (filterMode === "both" && (allowedStickers.has(ext) || allowedMedia.has(ext))) {
        match = true;
      }

      if (!match) continue;

      const fileName = path.basename(entry.entryName);
      const diskFileName = `${itemIndex}_${fileName}`;
      const destinationPath = path.join(sessionDir, diskFileName);

      fs.writeFileSync(destinationPath, entry.getData());

      const isAnimated = (await mediaConverter.isAnimated(destinationPath)) ? 1 : 0;
      const stats = fs.statSync(destinationPath);
      const suggestedTag = this.isGenericWhatsAppName(fileName)
        ? ""
        : this.sanitizeTag(fileName);

      const stagedItem: StagedItem = {
        id: uuidv4(),
        sessionId,
        fileName,
        filePath: destinationPath,
        isAnimated,
        fileSize: stats.size,
        suggestedTag,
      };

      this.stagedMap.set(stagedItem.id, stagedItem);
      items.push(stagedItem);
      itemIndex++;
    }

    return { sessionId, items };
  }

  public async commitStagedItem(options: CommitStagedOptions): Promise<StickerRecord> {
    const staged = this.stagedMap.get(options.stagedId);
    if (!staged) {
      throw new Error(`Staged item not found: ${options.stagedId}`);
    }

    if (!fs.existsSync(staged.filePath)) {
      this.stagedMap.delete(options.stagedId);
      throw new Error(`Staged file missing from disk: ${staged.filePath}`);
    }

    const stickerId = uuidv4();
    const relativeFileName = `${stickerId}.webp`;
    const outputPath = path.join(this.stickersDir, relativeFileName);

    let finalTag = options.tag?.trim();
    if (!finalTag) {
      finalTag = staged.suggestedTag || tagIndex.getNextUntitledTag();
    }
    finalTag = tagIndex.normalizeTag(finalTag);

    let finalSize = 0;
    if (staged.isAnimated) {
      const res = await mediaConverter.processAnimatedMedia({
        inputPath: staged.filePath,
        outputPath,
        mode: options.mode || "fit",
        cropX: options.cropX,
        cropY: options.cropY,
        cropWidth: options.cropWidth,
        cropHeight: options.cropHeight,
        startTime: options.startTime,
        duration: options.duration,
      });
      finalSize = res.size;
    } else {
      const res = await mediaConverter.processStaticImage({
        input: staged.filePath,
        outputPath,
        mode: options.mode || "fit",
        cropX: options.cropX,
        cropY: options.cropY,
        cropWidth: options.cropWidth,
        cropHeight: options.cropHeight,
      });
      finalSize = res.size;
    }

    // Clean up temporary staged file
    try {
      if (fs.existsSync(staged.filePath)) {
        fs.unlinkSync(staged.filePath);
      }
    } catch {
      // Ignored
    }
    this.stagedMap.delete(options.stagedId);

    const record: StickerRecord = {
      id: stickerId,
      tag: finalTag,
      file_path: relativeFileName,
      is_animated: staged.isAnimated,
      file_size: finalSize,
      created_at: Date.now(),
    };

    tagIndex.insert(record);
    return record;
  }

  public discardStagedItem(stagedId: string): boolean {
    const staged = this.stagedMap.get(stagedId);
    if (!staged) return false;

    try {
      if (fs.existsSync(staged.filePath)) {
        fs.unlinkSync(staged.filePath);
      }
    } catch {
      // Ignored
    }

    this.stagedMap.delete(stagedId);
    return true;
  }
}

export const stagingService = new StagingService();
