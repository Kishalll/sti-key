import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { stagingService, FilterMode } from "../services/StagingService.js";

const upload = multer({ dest: path.resolve(process.cwd(), "../storage/staging") });
const router = Router();

// POST /api/staging/upload-zip
router.post("/upload-zip", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No archive file uploaded" });
    return;
  }

  const archivePath = req.file.path;
  const filterMode: FilterMode =
    req.body.filterMode === "media_only" || req.body.filterMode === "both"
      ? req.body.filterMode
      : "stickers_only";

  try {
    const result = await stagingService.extractArchive(archivePath, filterMode);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to extract archive" });
  } finally {
    if (fs.existsSync(archivePath)) {
      try {
        fs.unlinkSync(archivePath);
      } catch {
        // Ignored
      }
    }
  }
});

// POST /api/staging/commit
router.post("/commit", async (req: Request, res: Response) => {
  const {
    stagedId,
    tag,
    mode,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    startTime,
    duration,
  } = req.body;

  if (!stagedId) {
    res.status(400).json({ error: "Missing stagedId parameter" });
    return;
  }

  try {
    const record = await stagingService.commitStagedItem({
      stagedId,
      tag,
      mode: mode === "crop" ? "crop" : "fit",
      cropX: cropX ? parseFloat(cropX) : undefined,
      cropY: cropY ? parseFloat(cropY) : undefined,
      cropWidth: cropWidth ? parseFloat(cropWidth) : undefined,
      cropHeight: cropHeight ? parseFloat(cropHeight) : undefined,
      startTime: startTime ? parseFloat(startTime) : undefined,
      duration: duration ? parseFloat(duration) : undefined,
    });
    res.status(201).json(record);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to commit staged item" });
  }
});

// DELETE /api/staging/:stagedId
router.delete("/:stagedId", (req: Request, res: Response) => {
  const stagedId = req.params.stagedId as string;
  const discarded = stagingService.discardStagedItem(stagedId);
  if (!discarded) {
    res.status(404).json({ error: "Staged item not found" });
    return;
  }
  res.json({ success: true });
});

export default router;
