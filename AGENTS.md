# Малина — заметки для агентов

Игра и код описаны в `README.md`, знания проекта — в вики `wiki/` (правила ведения — `wiki/CLAUDE.md`, оглавление — `wiki/index.md`).

## Тесты — всегда так

```bash
mise exec -- npm run build
PW_CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" mise exec -- npx playwright test
```

- Node — только через `mise exec` (версия в `mise.toml`).
- Браузер — установленный Google Chrome через `PW_CHROMIUM`. **Не запускать `npx playwright install`**: в песочнице нет сети, загрузка виснет. Подробности и как убрать недокачанное — `wiki/dev-testing.md`.
- Прогон ≈ 2 минуты — запускать в фоне.
