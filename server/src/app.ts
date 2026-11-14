import express from "express";
import cors from "cors";
import path from "node:path";
import stickersRouter from "./routes/stickers.js";
import stagingRouter from "./routes/staging.js";
import whatsappRouter from "./routes/whatsapp.js";

export function createApp(): express.Express {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logger middleware
  app.use((req, res, next) => {
    const start = Date.now();
    const isStatic = req.url.startsWith("/stickers") || req.url.startsWith("/staging");
    if (!isStatic) {
      const hasBody = req.body && Object.keys(req.body).length > 0;
      console.log(`[HTTP IN] ${new Date().toLocaleTimeString()} ${req.method} ${req.url}${hasBody ? " " + JSON.stringify(req.body) : ""}`);

      res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(`[HTTP OUT] ${new Date().toLocaleTimeString()} ${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`);
      });
    }
    next();
  });

  const stickersDir = path.resolve(process.cwd(), "../storage/stickers");
  const stagingDir = path.resolve(process.cwd(), "../storage/staging");

  app.use("/stickers", express.static(stickersDir));
  app.use("/staging", express.static(stagingDir));

  app.use("/api/stickers", stickersRouter);
  app.use("/api/staging", stagingRouter);
  app.use("/api/whatsapp", whatsappRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  return app;
}
