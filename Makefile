# Malina — running and checks (node via mise, see AGENTS.md)
#   make dev    — server (localhost:8787) and Vite client (localhost:5173) together, Ctrl+C stops both
#   make play   — build the game and start one server that also serves it: http://localhost:8787
#   make server / make client — separately
#   make check  — types and the fast net and simulation tests (seconds)
#   make e2e    — Playwright on the installed Google Chrome (≈17 min)
#   make docker-dev   — the same as dev, in Docker (docker-compose.dev.yml)
#   make docker-build — buildx build + push of the image, make deploy — build + deploy (wiki/dev-deploy.md)
MISE := mise exec --
PW_CHROMIUM ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
# own names, so PORT from the launcher's environment is not picked up
SERVER_PORT ?= 8787
CLIENT_PORT ?= 5173
DB_PATH ?= data/malina.db

.PHONY: dev play server client build check e2e typecheck test-net docker-dev docker-build deploy

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

docker-dev:
	docker compose -f docker-compose.dev.yml up --build

docker-build:
	cd deploy/ansible && ansible-playbook playbooks/build.yml

deploy:
	cd deploy/ansible && ansible-playbook playbooks/site.yml
