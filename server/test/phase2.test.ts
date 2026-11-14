import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import sharp from "sharp";
import { mediaConverter } from "../src/services/MediaConverterService.js";

console.log("Running Phase 2 Verification: Media Processing Pipelines...");

async function runTests(): Promise<void> {
  const tmpDir = path.resolve(process.cwd(), "test_tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  // 1. Create a 1920x1080 test image
  const staticSourceBuffer = await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 4,
      background: { r: 50, g: 150, b: 250, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  // Test isAnimated for static image
  const isAnimStatic = await mediaConverter.isAnimated(staticSourceBuffer);
  assert.strictEqual(isAnimStatic, false, "Static image should not be identified as animated");

  // 2. Test fit mode for static image
  const fitResult = await mediaConverter.processStaticImage({
    input: staticSourceBuffer,
    mode: "fit",
  });

  assert(fitResult.buffer, "Fit mode should return a buffer");
  assert(fitResult.size <= 102400, "Fit output size must be under 100 KB");
  assert.strictEqual(fitResult.isAnimated, 0, "isAnimated flag must be 0 for static image");

  const fitMeta = await sharp(fitResult.buffer).metadata();
  assert.strictEqual(fitMeta.width, 512, "Fit mode width must be 512");
  assert.strictEqual(fitMeta.height, 512, "Fit mode height must be 512");
  assert.strictEqual(fitMeta.format, "webp", "Output format must be webp");

  // 3. Test crop mode for static image
  const cropResult = await mediaConverter.processStaticImage({
    input: staticSourceBuffer,
    mode: "crop",
    cropX: 200,
    cropY: 100,
    cropWidth: 800,
    cropHeight: 800,
  });

  assert(cropResult.buffer, "Crop mode should return a buffer");
  assert(cropResult.size <= 102400, "Crop output size must be under 100 KB");
  assert.strictEqual(cropResult.isAnimated, 0, "isAnimated flag must be 0 for static image");

  const cropMeta = await sharp(cropResult.buffer).metadata();
  assert.strictEqual(cropMeta.width, 512, "Crop mode width must be 512");
  assert.strictEqual(cropMeta.height, 512, "Crop mode height must be 512");
  assert.strictEqual(cropMeta.format, "webp", "Output format must be webp");

  // 4. Test animated media pipeline using a generated 1.5s MP4
  const testMp4Path = path.join(tmpDir, "test_input.mp4");
  const testWebpOutputPath = path.join(tmpDir, "test_animated_output.webp");

  execSync(
    `ffmpeg -y -f lavfi -i testsrc=duration=1.5:size=320x240:rate=15 -pix_fmt yuv420p "${testMp4Path}"`,
    { stdio: "ignore" }
  );

  const isAnimVideo = await mediaConverter.isAnimated(testMp4Path);
  assert.strictEqual(isAnimVideo, true, "MP4 video should be identified as animated");

  const animResult = await mediaConverter.processAnimatedMedia({
    inputPath: testMp4Path,
    outputPath: testWebpOutputPath,
    mode: "fit",
    duration: 1.5,
  });

  assert(fs.existsSync(testWebpOutputPath), "Animated output file must exist");
  assert(animResult.size <= 500000, "Animated sticker must be under 500 KB");
  assert.strictEqual(animResult.isAnimated, 1, "isAnimated flag must be 1 for animated media");

  const animMeta = await sharp(testWebpOutputPath).metadata();
  assert.strictEqual(animMeta.width, 512, "Animated sticker width must be 512");
  assert.strictEqual(animMeta.height, 512, "Animated sticker height must be 512");
  assert.strictEqual(animMeta.format, "webp", "Animated output format must be webp");
  assert((animMeta.pages ?? 0) > 1, "Animated WebP must contain multiple frames");

  // Cleanup tmp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log("Phase 2 tests passed successfully: all outputs 512x512 WebP within size ceilings!");
}

runTests().catch((err) => {
  console.error("Phase 2 test failed:", err);
  process.exit(1);
});
