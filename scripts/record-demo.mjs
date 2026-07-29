/**
 * Records the in-app guided demo to a video file.
 *
 * Drives a real browser against the running stack, presses "Start demo", and captures the whole
 * tour. No compositing and no editing: what lands in the file is what the product did.
 *
 *   pnpm dev            # in one terminal
 *   pnpm demo:record    # in another
 *
 * Playwright is borrowed from the gstack skill rather than added to this repo's dependencies —
 * recording a marketing video is not a reason to put a browser automation stack (and a second
 * Chromium download) into a security product's tree.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "demo-recordings");
const URL_BASE = process.env.DEMO_URL ?? "http://localhost:3001";

/** 16:9 at a size where the sidebar, tables and captions all stay legible when scaled down. */
const WIDTH = Number(process.env.DEMO_WIDTH ?? 1600);
const HEIGHT = Number(process.env.DEMO_HEIGHT ?? 900);

/** The demo's own ceiling is 180s; allow for startup and the closing beat. */
const MAX_WAIT_MS = 210_000;

const PLAYWRIGHT_ROOT = join(homedir(), ".claude", "skills", "gstack", "node_modules", "playwright");
const FFMPEG = join(homedir(), "AppData", "Local", "ms-playwright", "ffmpeg-1011", "ffmpeg-win64.exe");

function run(bin, args) {
  return new Promise((done, fail) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`${bin} exited ${code}`))));
  });
}

async function main() {
  if (!existsSync(PLAYWRIGHT_ROOT)) {
    console.error(`Playwright not found at ${PLAYWRIGHT_ROOT}`);
    process.exit(1);
  }
  const { chromium } = await import(pathToFileURL(join(PLAYWRIGHT_ROOT, "index.mjs")).href);

  /* Clear the contents rather than the directory itself: on a OneDrive-backed path the folder is
     frequently held open by the sync client, and rmdir then fails with EBUSY. */
  await mkdir(OUT_DIR, { recursive: true });
  for (const entry of await readdir(OUT_DIR)) {
    await rm(join(OUT_DIR, entry), { recursive: true, force: true }).catch(() => {});
  }

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    recordVideo: { dir: OUT_DIR, size: { width: WIDTH, height: HEIGHT } },
  });

  const page = await context.newPage();
  const skipped = [];
  page.on("console", (msg) => {
    if (msg.text().includes("[demo] target not found")) skipped.push(msg.text());
  });

  console.log(`Opening ${URL_BASE}/dashboard …`);
  await page.goto(`${URL_BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60_000 });

  // The tour only means anything once the dashboard has its data.
  await page.waitForSelector(".gpd-trigger", { timeout: 30_000 });
  await page.waitForTimeout(2500);

  console.log("Starting the demo …");
  const startedAt = Date.now();
  await page.click(".gpd-trigger");

  // The control bar exists for exactly as long as the tour runs.
  await page.waitForSelector(".gpd-controls", { timeout: 15_000 });
  await page.waitForSelector(".gpd-controls", { state: "detached", timeout: MAX_WAIT_MS });

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  await page.waitForTimeout(1200); // let the last frame settle

  await context.close();
  await browser.close();

  const [webm] = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("Playwright produced no video");
  const webmPath = join(OUT_DIR, "gatepass-demo.webm");
  await rename(join(OUT_DIR, webm), webmPath);

  console.log(`\nRecorded ${seconds}s → ${webmPath}`);
  if (skipped.length > 0) {
    console.log(`${skipped.length} step(s) skipped — a control was missing:`);
    for (const line of skipped) console.log(`  ${line}`);
  } else {
    console.log("Every step found its target.");
  }

  /*
   * mp4 is a convenience, never a requirement — the .webm above is the deliverable and uploads
   * fine to YouTube, Vimeo and Drive. Playwright's bundled ffmpeg is built with
   * `--disable-everything` plus a VP8/webm allowlist, so it cannot produce h264; a system ffmpeg
   * can. Either way a failed conversion must not fail a recording that already succeeded.
   */
  const encoder = await encoderFor("libx264");
  if (encoder) {
    const mp4Path = join(OUT_DIR, "gatepass-demo.mp4");
    console.log(`Converting to mp4 with ${encoder} …`);
    await run(encoder, [
      "-y",
      "-i",
      webmPath,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "20",
      // Both dimensions must be even for yuv420p, which is what every player expects.
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      mp4Path,
    ]).then(
      () => console.log(`Wrote ${mp4Path}`),
      (err) => console.log(`mp4 conversion failed (${err.message}); the .webm is still good.`),
    );
  } else {
    console.log("No h264-capable ffmpeg found — keeping the .webm.");
    console.log("  For mp4: winget install Gyan.FFmpeg, then re-run.");
  }
}

/** First ffmpeg on hand that can actually encode `codec`, or null. */
async function encoderFor(codec) {
  for (const bin of ["ffmpeg", FFMPEG]) {
    if (bin === FFMPEG && !existsSync(FFMPEG)) continue;
    const supported = await new Promise((done) => {
      const probe = spawn(bin, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      probe.stdout.on("data", (c) => (out += c));
      probe.on("error", () => done(false));
      probe.on("exit", () => done(out.includes(codec)));
    });
    if (supported) return bin;
  }
  return null;
}

await main();
