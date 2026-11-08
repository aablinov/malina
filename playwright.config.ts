import { defineConfig } from '@playwright/test';
import { cpus } from 'node:os';

// Tests open the built dist/index.html (npm run build): dev pages without a server, the camp and battles from it — through their own
// server (tests/game-server.ts, the hero lives only there). The simulation is driven through __malina.step(); an automated run
// does not draw frames by itself (src/devflag.ts AUTOMATED), a test draws with __malina.render() when it needs pixels.
//
// WebGL: on macOS — the real GPU even headless (Metal: a page starts in ~1.6 s, a frame costs milliseconds and does not take the CPU
// from the parallel tests); elsewhere — SwiftShader, software (slow, CPU-bound). PERF_GPU=1 — a browser window (perf frame times).
const METAL = process.platform === 'darwin' && !process.env.PW_SOFTWARE;
const GPU_ARGS = METAL || process.env.PERF_GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export default defineConfig({
  testDir: 'tests',
  // every test on its own worker slot
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS) || cpus().length,
  timeout: 180_000,
  reporter: 'list',
  use: {
    // small: a drawn frame costs per pixel (in SwiftShader — a lot)
    viewport: { width: 640, height: 400 },
    headless: !process.env.PERF_GPU,
    launchOptions: {
      // the page links Google Fonts: without network the request hangs and holds the "load" event for a minute (and the
      // connection pool for the next pages) — tests do not go to the network, the font hosts fail at once
      args: [...GPU_ARGS, '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND'],
      // own Chromium if Playwright browsers were not installed: PW_CHROMIUM=/path/to/chrome
      executablePath: process.env.PW_CHROMIUM || undefined,
    },
  },
});
