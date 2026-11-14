import express from "express";
import cors from "cors";
import path from "node:path";
import stickersRouter from "./routes/stickers.js";
import stagingRouter from "./routes/staging.js";

export function createApp(): express.Express {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const stickersDir = path.resolve(process.cwd(), "../storage/stickers");
  const stagingDir = path.resolve(process.cwd(), "../storage/staging");

  app.use("/stickers", express.static(stickersDir));
  app.use("/staging", express.static(stagingDir));

  app.use("/api/stickers", stickersRouter);
  app.use("/api/staging", stagingRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  return app;
}
