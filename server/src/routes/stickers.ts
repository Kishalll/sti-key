import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { tagIndex } from "../services/TagIndexService.js";
import { mediaConverter } from "../services/MediaConverterService.js";
import { StickerRecord } from "../types/index.js";

const stickersDir = path.resolve(process.cwd(), "../storage/stickers");
if (!fs.existsSync(stickersDir)) {
  fs.mkdirSync(stickersDir, { recursive: true });
}

const upload = multer({ dest: path.resolve(process.cwd(), "../storage/staging") });
const router = Router();

// GET /api/stickers?search=<query>
router.get("/", (req: Request, res: Response) => {
  const query = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const stickers = query ? tagIndex.searchSimilar(query) : tagIndex.getAll();
  const stats = tagIndex.getStats();
  res.json({ stickers, stats });
});

// POST /api/stickers/upload
router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No media file uploaded" });
    return;
  }

  const tempFilePath = req.file.path;
  try {
    const rawTag = typeof req.body.tag === "string" && req.body.tag.trim()
      ? req.body.tag.trim()
      : tagIndex.getNextUntitledTag();
    const tag = tagIndex.normalizeTag(rawTag);

    const mode = req.body.mode === "crop" ? "crop" : "fit";
    const cropX = req.body.cropX ? parseFloat(req.body.cropX) : undefined;
    const cropY = req.body.cropY ? parseFloat(req.body.cropY) : undefined;
    const cropWidth = req.body.cropWidth ? parseFloat(req.body.cropWidth) : undefined;
    const cropHeight = req.body.cropHeight ? parseFloat(req.body.cropHeight) : undefined;
    const startTime = req.body.startTime ? parseFloat(req.body.startTime) : undefined;
    const duration = req.body.duration ? parseFloat(req.body.duration) : undefined;

    const stickerId = uuidv4();
    const relativeFileName = `${stickerId}.webp`;
    const outputPath = path.join(stickersDir, relativeFileName);

    const isAnimated = (await mediaConverter.isAnimated(tempFilePath)) ? 1 : 0;
    let finalSize = 0;

    if (isAnimated) {
      const result = await mediaConverter.processAnimatedMedia({
        inputPath: tempFilePath,
        outputPath,
        mode,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        startTime,
        duration,
      });
      finalSize = result.size;
    } else {
      const result = await mediaConverter.processStaticImage({
        input: tempFilePath,
        outputPath,
        mode,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
      });
      finalSize = result.size;
    }

    const record: StickerRecord = {
      id: stickerId,
      tag,
      file_path: relativeFileName,
      is_animated: isAnimated,
      file_size: finalSize,
      created_at: Date.now(),
    };

    tagIndex.insert(record);
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to process sticker" });
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // Ignored
      }
    }
  }
});

// PATCH /api/stickers/:id
router.patch("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const newTag = typeof req.body.tag === "string" ? req.body.tag : "";
  if (!newTag.trim()) {
    res.status(400).json({ error: "Tag cannot be empty" });
    return;
  }

  const updated = tagIndex.updateTag(id, newTag);
  if (!updated) {
    res.status(404).json({ error: "Sticker not found" });
    return;
  }

  res.json(updated);
});

// DELETE /api/stickers/:id
router.delete("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = tagIndex.delete(id);
  if (!deleted) {
    res.status(404).json({ error: "Sticker not found" });
    return;
  }

  const filePath = path.join(stickersDir, deleted.file_path);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignored
    }
  }

  res.json({ success: true });
});

export default router;
