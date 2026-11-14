import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";

export interface ProcessStaticOptions {
  input: string | Buffer;
  outputPath?: string;
  mode?: "fit" | "crop";
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
}

export interface ProcessAnimatedOptions {
  inputPath: string;
  outputPath: string;
  mode?: "fit" | "crop";
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  startTime?: number;
  duration?: number;
}

export interface MediaProcessResult {
  filePath?: string;
  buffer?: Buffer;
  size: number;
  isAnimated: number;
}

export class MediaConverterService {
  public async isAnimated(input: string | Buffer): Promise<boolean> {
    try {
      if (typeof input === "string") {
        const ext = path.extname(input).toLowerCase();
        if ([".mp4", ".webm", ".mov", ".mkv"].includes(ext)) {
          return true;
        }
      }
      const meta = await sharp(input).metadata();
      return (meta.pages ?? 1) > 1;
    } catch {
      return false;
    }
  }

  public async processStaticImage(options: ProcessStaticOptions): Promise<MediaProcessResult> {
    const {
      input,
      outputPath,
      mode = "fit",
      cropX = 0,
      cropY = 0,
      cropWidth,
      cropHeight,
    } = options;

    const image = sharp(input);
    const meta = await image.metadata();
    const natWidth = meta.width || 512;
    const natHeight = meta.height || 512;

    let pipeline = sharp(input);

    if (mode === "crop" && cropWidth && cropHeight) {
      const left = Math.max(0, Math.min(natWidth - 1, Math.round(cropX)));
      const top = Math.max(0, Math.min(natHeight - 1, Math.round(cropY)));
      const width = Math.min(natWidth - left, Math.max(1, Math.round(cropWidth)));
      const height = Math.min(natHeight - top, Math.max(1, Math.round(cropHeight)));

      pipeline = pipeline.extract({ left, top, width, height }).resize(512, 512);
    } else {
      pipeline = pipeline.resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
    }

    let quality = 80;
    let buffer = await pipeline
      .clone()
      .webp({ quality, alphaQuality: 80, effort: 4 })
      .toBuffer();

    // 100 KB size ceiling enforcement
    while (buffer.length > 102400 && quality > 20) {
      quality -= 15;
      buffer = await pipeline
        .clone()
        .webp({ quality, alphaQuality: 80, effort: 4 })
        .toBuffer();
    }

    if (outputPath) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await fs.promises.writeFile(outputPath, buffer);
    }

    return {
      filePath: outputPath,
      buffer,
      size: buffer.length,
      isAnimated: 0,
    };
  }

  public async processAnimatedMedia(options: ProcessAnimatedOptions): Promise<MediaProcessResult> {
    const {
      inputPath,
      outputPath,
      mode = "fit",
      cropX = 0,
      cropY = 0,
      cropWidth,
      cropHeight,
      startTime = 0,
      duration = 5.0,
    } = options;

    const clampedDuration = Math.min(10.0, Math.max(0.5, duration));
    const start = Math.max(0, startTime);
    const targetKbps = Math.floor(3520 / clampedDuration);

    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const buildFilter = (fps: number): string => {
      if (mode === "crop" && cropWidth && cropHeight) {
        return `fps=${fps},crop=${Math.round(cropWidth)}:${Math.round(cropHeight)}:${Math.round(cropX)}:${Math.round(cropY)},scale=512:512,format=rgba`;
      }
      return `fps=${fps},scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000`;
    };

    const runEncoding = (fps: number, quality: number): Promise<void> => {
      return new Promise((resolve, reject) => {
        let cmd = ffmpeg(inputPath)
          .setStartTime(start)
          .setDuration(clampedDuration)
          .outputOptions([
            "-vcodec libwebp",
            "-an",
            `-r ${fps}`,
            "-loop 0",
            "-compression_level 6",
            `-q:v ${quality}`,
            "-preset default",
            `-b:v ${targetKbps}k`,
            `-vf ${buildFilter(fps)}`,
          ])
          .output(outputPath);

        cmd
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });
    };

    // Primary pass at 15 fps, quality 50
    await runEncoding(15, 50);

    let stats = await fs.promises.stat(outputPath);

    // Fallback pass if over 500 KB limit
    if (stats.size > 500000) {
      await runEncoding(10, 30);
      stats = await fs.promises.stat(outputPath);
    }

    return {
      filePath: outputPath,
      size: stats.size,
      isAnimated: 1,
    };
  }
}

export const mediaConverter = new MediaConverterService();
