# Deploy: Docker, Caddy and Ansible

> Version 2 · 2026-11-05

One image runs the whole game: `node server/main.ts` serves the built `dist/index.html` at `/` and the API at `/api`, `/ws`, `/game` (see [design-multiplayer.md](design-multiplayer.md)). SQLite lives in the `/data` volume. In production Caddy stands in front: HTTPS from Let's Encrypt, HTTP → HTTPS, compression of the game and `/api`, WebSocket passed through.

## Files
| File | What it is |
|---|---|
| `Dockerfile` | Stages: `deps` (npm ci) → `dev` (for compose dev) / `build` (tsc + vite) → `prod-deps` → `runtime` (user `node`, healthcheck on `/api/health`) |
| `docker-compose.dev.yml` | `server` (`node --watch`) and `client` (Vite) with sources mounted; node_modules and the DB in volumes |
| `docker-compose.prod.yml` | `malina` (on `127.0.0.1:8787` of the host) and `caddy` (profile `caddy`, ports 80, 443, 443/udp); volumes `data`, `caddy_data`, `caddy_config` |
| `deploy/caddy/Caddyfile` | Site `{$MALINA_DOMAIN}`, ACME email `{$ACME_EMAIL}`; `/ws` and `/game` without `encode` |
| `deploy/ansible/` | `build.yml` — buildx multi-platform build and push; `deploy.yml` — files to `/opt/malina`, compose up, health checks; `site.yml` — both |

## Make targets
| Target | What it does |
|---|---|
| `make docker-dev` | Development in Docker: http://localhost:5173, server :8787 |
| `make image-build` | Production image for this machine (`--load`), tags `:<commit>` and `:local` |
| `make image-run` / `image-stop` | That image with Caddy at https://localhost:8443 (Caddy's local CA — `curl -k`, the browser warns) |
| `make image-login` | `GHCR_TOKEN=… make image-login` — docker login to ghcr.io for pushing |
| `make image-push` | Ansible `build.yml`: buildx amd64+arm64, push `:<commit>` + `:latest`; `PLATFORMS=linux/amd64` — faster |
| `make ansible-ping` | ssh to the servers works |
| `make ansible-check` | Dry run of the deploy with a diff of `docker-compose.yml`, `.env`, `Caddyfile` |
| `make ansible-deploy` | Deploy `TAG` (default — the current commit); rollback: `make ansible-deploy TAG=<old sha>` |
| `make deploy` | `image-push` + `ansible-deploy` |
| `make ansible-vault` | Create (from `vault.example.yml`, then encrypt) or edit the vault |
| `make ansible-logs` | Last 100 lines of the server logs |

Extra Ansible arguments — `ARGS='--limit malina-prod -e malina_check_https=false'`. Vault password: the file `deploy/ansible/.vault-pass` if it exists, else Ansible asks (only when the vault is encrypted).

## What to prepare
**Domain.** An A (and AAAA, if the server has IPv6) record of the game's domain → the server IP. Without it Let's Encrypt will not issue a certificate.

**Server** (Debian/Ubuntu, 1 vCPU / 1 GB is enough): Docker Engine with the compose plugin (`docs.docker.com/engine/install`), a user for ssh by key, in the `docker` group, with python3 (Ansible needs it); firewall open for 22/tcp, 80/tcp, 443/tcp, 443/udp. Port 8787 stays closed — it listens on 127.0.0.1 only.

**GitHub (ghcr.io).** Two tokens (classic PAT): with `write:packages` — for pushing from this machine, with `read:packages` — for the server (only if the package is private; a public package needs no login).

**This machine.** Docker with buildx, Ansible (`community.docker` is not needed), ssh access to the server.

## Where the settings go
| What | Where |
|---|---|
| Server address, ssh user, `malina_domain`, `acme_email` | `deploy/ansible/inventory/hosts.yml` (copy of `hosts.example.yml`, not in git) |
| `registry_username`, `registry_password` (read token) | `deploy/ansible/inventory/group_vars/all/vault.yml` — `make ansible-vault`, not in git |
| Vault password | `deploy/ansible/.vault-pass` (one line, `chmod 600`, not in git) — or type it every time |
| Push token | `GHCR_TOKEN` in the environment for `make image-login` |
| Image, platforms, ports, `/opt/malina`, Caddy on/off, HTTPS check | `deploy/ansible/inventory/group_vars/all/main.yml` (defaults; override per host in `hosts.yml`) |

On the server Ansible writes `/opt/malina/docker-compose.yml`, `/opt/malina/deploy/caddy/Caddyfile` and `/opt/malina/.env` (`MALINA_IMAGE`, `MALINA_TAG`, `MALINA_DOMAIN`, `ACME_EMAIL`, `COMPOSE_PROFILES=caddy`, ports). By hand on the server: `cd /opt/malina && docker compose ps / logs -f / restart`.

## First deploy
```bash
cp deploy/ansible/inventory/hosts.example.yml deploy/ansible/inventory/hosts.yml   # edit
make ansible-vault          # only for a private image
GHCR_TOKEN=ghp_… make image-login
make ansible-ping
make deploy
```

## Notes
- Tag — `git describe --always --dirty`; with uncommitted changes the build refuses to push `:latest` (allow with `ARGS='-e malina_push_latest=false'`).
- Build cache goes to `<image>:buildcache` in the registry; `-e malina_cache_ref=` turns it off.
- Own proxy instead of Caddy: `malina_caddy: false` and proxy to `malina_bind:malina_port` with WebSocket upgrade for `/ws`, `/game`.
- A changed Caddyfile is applied with `caddy reload` (compose does not notice it); the directory is mounted, not the file — Ansible replaces the file and a single-file mount would keep the old one.
- `/game` compresses itself (permessage-deflate) — Caddy's `encode` is off for `/ws` and `/game`.
- Dev in Docker: the client on port 5173 looks for the server at `localhost:8787`, with a different `SERVER_PORT` open `?server=http://localhost:<port>`. After changing `package.json` — `--renew-anon-volumes`. The dev DB is in the `malina-dev_data` volume, not `./data`: SQLite WAL locks over a macOS bind mount are unreliable.

## Pitfalls
- A file with mode `600` in the working copy is unreadable for user `node`: the `build` stage runs `chmod -R a+rX` on `server src assets`, `runtime` copies them from there.
- `docker compose down -v` deletes the database and the certificates (`caddy_data`); Let's Encrypt limits re-issuing.
- An empty `ACME_EMAIL` breaks the Caddyfile — `deploy.yml` checks it.
