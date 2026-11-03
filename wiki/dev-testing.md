# Тесты: как запускать Playwright

> Версия 2 · 04.11.2026

Тесты — `tests/playground.spec.ts`, конфиг — `playwright.config.ts`. Они открывают собранный `dist/index.html` без сервера, WebGL — программный (SwiftShader), симуляцию гоняют через `window.__malina`.

## Быстрые тесты сети и симуляции — `npm run test:net`

```bash
mise exec -- npm run typecheck && mise exec -- npm run test:net
```

`server/test/*.test.ts` на `node:test` без браузера: сервер (вход, комнаты, итог), протокол и канал, кодек снимков, симуляция боя с сидом, матч над петлёй в памяти — секунды, не минуты. Гонять перед каждым коммитом; Playwright — только при правках вида и UI и в конце этапа. `headless.test.ts` — безголовый бой: настоящие `Knight`, `Gear` и стая `Pack` на карте `td` в Node со сценой без рендера и `nullFx` (`src/headless.ts`), волна до конца и хэш детерминизма. `sim-boundary.test.ts` — страж: модули `src/sim`, `src/net`, `src/game` общие для сервера и браузера, грузятся в Node и не трогают DOM, сцену three, FX, звук, `Math.random` и часы (`tsconfig.server.json` проверяет их без `lib: DOM`).

## Рецепт Playwright (работает у агентов и в песочнице)

```bash
mise exec -- npm run build
PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test
```

- **Код игры должен грузиться в Node** (type stripping): импорты только с `.ts`, без `enum` и свойств-параметров конструктора — иначе `headless.test.ts` падает на `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; найти виновника — `node -e` со `stripTypeScriptTypes` из `node:module` по всем файлам.
- **Node — через mise** (`mise.toml`: node 26.7.0). Без `mise exec` подхватывается чужой node из `PATH` (например `~/.hermes/node`).
- **Браузер — установленный Google Chrome** через `PW_CHROMIUM` (`launchOptions.executablePath` в конфиге). Скачивать браузер не нужно.
- **Не запускать `npx playwright install chromium`** в песочнице агента: в ней нет сети, загрузка виснет на первых сотнях КБ и оставляет `~/Library/Caches/ms-playwright/__dirlock` и недокачанную папку `chromium-*`. Если такое случилось — убить процессы `playwright install` / `oopDownloadBrowserMain` и удалить эти две папки.
- Ошибка `Executable doesn't exist at …/chromium_headless_shell-…` значит, что забыли `PW_CHROMIUM`, а не что надо качать браузер.
- 15 тестов идут ≈ 2 минуты в один поток; длинный прогон — в фоне.
- Перф-тесты `tests/perf.spec.ts` с `PERF_GPU=1` открывают Chrome в окне на настоящем GPU (Metal) — только так время кадра имеет смысл; без флага они проверяют лишь утечки и число программ ([dev-performance.md](dev-performance.md)).

Проверено 24.10.2026: 15 из 15 зелёные (node 26.7.0, Playwright 1.56.1, Google Chrome из `/Applications`).
