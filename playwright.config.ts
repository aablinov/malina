import { defineConfig } from '@playwright/test';

// Тесты открывают собранный dist/index.html (npm run build) без сервера.
// WebGL — программный (SwiftShader), поэтому рендер медленный; симуляцию гоняем через __malina.step().
export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      // свой Chromium, если не ставили браузеры Playwright: PW_CHROMIUM=/путь/к/chrome
      executablePath: process.env.PW_CHROMIUM || undefined,
    },
  },
});
