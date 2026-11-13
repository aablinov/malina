import { defineConfig } from '@playwright/test';

// Tutorial screenshots (wiki/design-tutorial.md): `make shots` shoots every card in both languages into public/tutorial/<lang>/.
// Not a test run: a bigger window at double density, the real GPU, and the font hosts are NOT blocked — the pictures need
// Press Start 2P and Rubik from Google Fonts, so this needs the network (scripts/shots/lib.ts fails without the fonts).
export default defineConfig({
  testDir: 'scripts/shots',
  testMatch: '*.shots.ts',
  fullyParallel: true,
  workers: Number(process.env.PW_WORKERS) || 4,
  timeout: 240_000,
  reporter: 'list',
  use: {
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 2,
    headless: true,
    launchOptions: {
      args: process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      executablePath: process.env.PW_CHROMIUM || undefined,
    },
  },
  projects: [{ name: 'en' }, { name: 'ru' }],
});
