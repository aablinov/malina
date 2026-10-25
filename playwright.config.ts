import { defineConfig } from '@playwright/test';

// Тесты открывают собранный dist/index.html (npm run build) без сервера.
// WebGL — программный (SwiftShader), поэтому рендер медленный; симуляцию гоняем через __malina.step().
export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    // PERF_GPU=1 — настоящий GPU в окне браузера (перф-тесты: время рендера имеет смысл только так)
    headless: !process.env.PERF_GPU,
    launchOptions: {
      args: process.env.PERF_GPU ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      // свой Chromium, если не ставили браузеры Playwright: PW_CHROMIUM=/путь/к/chrome
      executablePath: process.env.PW_CHROMIUM || undefined,
    },
  },
});
