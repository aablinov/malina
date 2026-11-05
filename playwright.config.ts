import { defineConfig } from '@playwright/test';

// Tests open the built dist/index.html (npm run build) without a server.
// WebGL is software (SwiftShader), so rendering is slow; the simulation is driven through __malina.step().
export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    // PERF_GPU=1 — a real GPU in a browser window (perf tests: render time only makes sense that way)
    headless: !process.env.PERF_GPU,
    launchOptions: {
      args: process.env.PERF_GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      // own Chromium if Playwright browsers were not installed: PW_CHROMIUM=/path/to/chrome
      executablePath: process.env.PW_CHROMIUM || undefined,
    },
  },
});
