import { Router, Request, Response } from "express";
import { whatsAppService } from "../services/WhatsAppService.js";
import { wsService } from "../ws/WebSocketService.js";

const router = Router();

// GET /api/whatsapp/status
router.get("/status", (_req: Request, res: Response) => {
  res.json(wsService.getStatus());
});

// POST /api/whatsapp/connect
router.post("/connect", async (_req: Request, res: Response) => {
  await whatsAppService.connect();
  res.json({ success: true });
});

// POST /api/whatsapp/send-sticker
router.post("/send-sticker", async (req: Request, res: Response) => {
  const { chatJid, stickerId } = req.body;
  if (!chatJid || !stickerId) {
    res.status(400).json({ error: "Missing chatJid or stickerId" });
    return;
  }

  try {
    await whatsAppService.sendDirectSticker(chatJid, stickerId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to send sticker" });
  }
});

// POST /api/whatsapp/logout
router.post("/logout", async (_req: Request, res: Response) => {
  await whatsAppService.logout();
  res.json({ success: true });
});

export default router;
