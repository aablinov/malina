# Малина — запуск и проверки (node через mise, см. AGENTS.md)
#   make dev    — сервер (localhost:8787) и клиент Vite (localhost:5173) вместе, Ctrl+C гасит оба
#   make play   — собрать игру и поднять один сервер, который отдаёт и игру: http://localhost:8787
#   make server / make client — по отдельности
#   make check  — типы и быстрые тесты сети и симуляции (секунды)
#   make e2e    — Playwright на установленном Google Chrome (≈17 мин)
MISE := mise exec --
PW_CHROMIUM ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
# свои имена, чтобы не подхватить PORT из окружения запускателя
SERVER_PORT ?= 8787
CLIENT_PORT ?= 5173
DB_PATH ?= data/malina.db

.PHONY: dev play server client build check e2e typecheck test-net

dev:
	@trap 'kill 0' INT TERM; \
	PORT=$(SERVER_PORT) DB_PATH=$(DB_PATH) $(MISE) node server/main.ts & \
	$(MISE) npx vite --port $(CLIENT_PORT) --strictPort & \
	wait

server:
	PORT=$(SERVER_PORT) DB_PATH=$(DB_PATH) $(MISE) node server/main.ts

client:
	$(MISE) npx vite --port $(CLIENT_PORT) --strictPort

build:
	$(MISE) npm run build

play: build
	PORT=$(SERVER_PORT) DB_PATH=$(DB_PATH) STATIC=dist $(MISE) node server/main.ts

typecheck:
	$(MISE) npm run typecheck

test-net:
	$(MISE) npm run test:net

check: typecheck test-net

e2e: build
	PW_CHROMIUM="$(PW_CHROMIUM)" $(MISE) npx playwright test
