# Malina — running and checks (node via mise, see AGENTS.md)
#   make dev    — server (localhost:8787) and Vite client (localhost:5173) together, Ctrl+C stops both
#   make play   — build the game and start one server that also serves it: http://localhost:8787
#   make server / make client — separately
#   make check  — types and the fast net and simulation tests (seconds)
#   make e2e    — Playwright on the installed Google Chrome (≈17 min)
#   make docker-dev   — the same as dev, in Docker (docker-compose.dev.yml)
#   make image-build / image-run / image-push, make ansible-deploy, make deploy — see "Docker and deploy" below
MISE := mise exec --
PW_CHROMIUM ?= /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
# own names, so PORT from the launcher's environment is not picked up
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

# ---- Docker and deploy (wiki/dev-deploy.md) ------------------------------------------------------------
#   make docker-dev        — development in Docker: server :8787 + Vite :5173
#   make image-build       — build the production image for this machine only (--load, nothing is pushed)
#   make image-run         — run it with Caddy at https://localhost:8443 (Caddy's own CA, curl -k)
#   make image-login       — docker login to the registry: GHCR_TOKEN=… make image-login
#   make image-push        — buildx multi-platform build + push (Ansible build.yml); PLATFORMS=linux/amd64 is faster
#   make ansible-ping      — check ssh to the servers
#   make ansible-check     — dry run of the deploy with a diff of the files
#   make ansible-deploy    — deploy TAG (default: the current commit) to the servers
#   make deploy            — image-push + ansible-deploy
#   make ansible-vault     — create or edit the encrypted vault (registry password)
#   make ansible-logs      — the last 100 lines of the server logs
# Extra Ansible arguments: ARGS='-e malina_check_https=false --limit malina-prod'
IMAGE ?= ghcr.io/aablinov/malina
REGISTRY_USER ?= aablinov
ANSIBLE_DIR := deploy/ansible
VAULT_FILE := inventory/group_vars/all/vault.yml
LOCAL_TAG := $(shell git describe --always --dirty --abbrev=12 --match=NO-TAGS 2>/dev/null)
# vault password: deploy/ansible/.vault-pass if there is one, else ask — only when the vault is encrypted
VAULT_ARGS = $(shell cd $(ANSIBLE_DIR) && if [ -f .vault-pass ]; then echo --vault-password-file .vault-pass; \
	elif [ -f $(VAULT_FILE) ] && head -1 $(VAULT_FILE) | grep -q ANSIBLE_VAULT; then echo --ask-vault-pass; fi)
ANSIBLE_E = $(if $(TAG),-e malina_tag=$(TAG)) $(if $(PLATFORMS),-e malina_platforms=$(PLATFORMS))
PLAYBOOK = cd $(ANSIBLE_DIR) && ansible-playbook $(VAULT_ARGS) $(ANSIBLE_E) $(ARGS)
COMPOSE_PROD = docker compose -p malina-local -f docker-compose.prod.yml

.PHONY: docker-dev image-build image-run image-stop image-login image-push ansible-ping ansible-check ansible-deploy deploy ansible-vault ansible-logs

docker-dev:
	docker compose -f docker-compose.dev.yml up --build

image-build:
	docker buildx build --target runtime --load -t $(IMAGE):$(LOCAL_TAG) -t $(IMAGE):local .

image-run: image-build
	MALINA_IMAGE=$(IMAGE) MALINA_TAG=local MALINA_PORT=18787 MALINA_DOMAIN=localhost ACME_EMAIL=dev@localhost COMPOSE_PROFILES=caddy \
	CADDY_HTTP_PORT=8080 CADDY_HTTPS_PORT=8443 $(COMPOSE_PROD) up -d --wait
	@echo "https://localhost:8443 (self-signed: Caddy local CA). Stop: make image-stop"

image-stop:
	COMPOSE_PROFILES=caddy $(COMPOSE_PROD) down

image-login:
	@test -n "$$GHCR_TOKEN" || { echo "GHCR_TOKEN=<github token with write:packages> make image-login"; exit 1; }
	@echo "$$GHCR_TOKEN" | docker login $(firstword $(subst /, ,$(IMAGE))) -u $(REGISTRY_USER) --password-stdin

image-push:
	$(PLAYBOOK) playbooks/build.yml

ansible-ping:
	cd $(ANSIBLE_DIR) && ansible malina -m ansible.builtin.ping $(ARGS)

ansible-check:
	$(PLAYBOOK) playbooks/deploy.yml --check --diff

ansible-deploy:
	$(PLAYBOOK) playbooks/deploy.yml

deploy:
	$(PLAYBOOK) playbooks/site.yml

ansible-vault:
	@cd $(ANSIBLE_DIR) && if [ -f $(VAULT_FILE) ]; then ansible-vault edit $(VAULT_ARGS) $(VAULT_FILE); \
	else cp vault.example.yml $(VAULT_FILE) && $${EDITOR:-vi} $(VAULT_FILE) \
	&& ansible-vault encrypt $(if $(wildcard $(ANSIBLE_DIR)/.vault-pass),--vault-password-file .vault-pass) $(VAULT_FILE); fi

ansible-logs:
	cd $(ANSIBLE_DIR) && ansible malina $(VAULT_ARGS) -a "docker compose --project-directory /opt/malina logs --tail 100" $(ARGS)
