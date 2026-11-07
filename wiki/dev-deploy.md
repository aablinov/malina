# Deploy: Docker, Caddy and Ansible

> Version 3 · 2026-11-07

One image runs the whole game: `node server/main.ts` serves the built `dist/index.html` at `/` and the API at `/api`, `/ws`, `/game` (see [design-multiplayer.md](design-multiplayer.md)). SQLite lives in the `/data` volume. In production Caddy stands in front: HTTPS from Let's Encrypt, HTTP → HTTPS, compression of the game and `/api`, WebSocket passed through.

**No registry.** Images are built on the developer machine and copied to the server over ssh: `docker buildx build --load` → `docker save --platform <server's> | gzip` → Ansible `copy` → `docker load`. Caddy goes the same way, so the server never talks to Docker Hub (`pull_policy: never` in compose).

## Files
| File | What it is |
|---|---|
| `Dockerfile` | Stages: `deps` (npm ci) → `dev` (for compose dev) / `build` (tsc + vite) → `prod-deps` → `runtime` (user `node`, healthcheck on `/api/health`) |
| `docker-compose.dev.yml` | `server` (`node --watch`) and `client` (Vite) with sources mounted; node_modules and the DB in volumes |
| `docker-compose.prod.yml` | `malina` (on `127.0.0.1:8787` of the host) and `caddy` (profile `caddy`, ports 80, 443, 443/udp); volumes `data`, `caddy_data`, `caddy_config` |
| `deploy/caddy/Caddyfile` | Site `{$MALINA_DOMAIN}`, ACME email `{$ACME_EMAIL}`; `/ws` and `/game` without `encode` |
| `deploy/ansible/playbooks/push.yml` | 1) on the servers: `uname -m`, which images are missing; 2) here: build / pull for those platforms, save to `deploy/ansible/.images/`; 3) on the servers: copy, `docker load`, remove the archive. No restart |
| `deploy/ansible/playbooks/deploy.yml` | `push.yml`, then files to `/opt/malina`, `compose up --wait`, health checks, old images removed (the last 5 stay) |

## Make targets
| Target | What it does |
|---|---|
| `make docker-dev` | Development in Docker: http://localhost:5173, server :8787 |
| `make image-build` | Production image for this machine, tags `malina:<commit>` and `malina:local` |
| `make image-run` / `image-stop` | That image with Caddy at https://localhost:8443 (Caddy's local CA — `curl -k`, the browser warns) |
| `make image-push` | Build for the servers' platform and upload what they lack, containers untouched |
| `make ansible-ping` | ssh to the servers works |
| `make ansible-check` | Dry run of the deploy with a diff of `docker-compose.yml`, `.env`, `Caddyfile` |
| `make ansible-deploy` (= `make deploy`) | `image-push` + compose up + checks; rollback: `TAG=<sha>` |
| `make ansible-vault` | Create (from `vault.example.yml`, `$EDITOR`, encrypt) or edit the vault |
| `make ansible-logs` | Last 100 lines of the server logs |

Extra Ansible arguments — `ARGS='--limit malina-prod -e malina_check_https=false'`. Vault password: the file `deploy/ansible/.vault-pass` if it exists, else Ansible asks (only when the vault is encrypted).

## What to prepare
**Domain.** An A (and AAAA, if the server has IPv6) record of the game's domain → the server IP. Without it Let's Encrypt will not issue a certificate.

**Server** (Debian/Ubuntu, amd64 or arm64, 1 vCPU / 1 GB is enough, ~2 GB disk for images): Docker Engine with the compose plugin, python3 (Ansible needs it), a user for ssh by key in the `docker` group; firewall open for 22/tcp, 80/tcp, 443/tcp, 443/udp. Port 8787 stays closed — it listens on 127.0.0.1 only. Docker itself is installed once by hand (from the distribution — `docker.io` + `docker-compose-v2` on Ubuntu — or from Docker's apt repository).

**This machine.** Docker with buildx and the **containerd image store** (Docker Desktop: Settings → General → "Use containerd for pulling and storing images", on by default in new installs) — needed for `docker save --platform` and building for another architecture; Ansible; ssh to the server by key.

## Where the settings go
| What | Where |
|---|---|
| Server address, ssh user/port/key, `malina_domain`, `acme_email` | `deploy/ansible/inventory/hosts.yml` (copy of `hosts.example.yml`, not in git) |
| Secrets (sudo password, if ever needed) | `deploy/ansible/inventory/group_vars/all/vault.yml` — `make ansible-vault`, not in git; nothing is needed there today |
| Vault password | `deploy/ansible/.vault-pass` (one line, `chmod 600`, not in git) — or type it every time |
| Image name, Caddy version, ports, `/opt/malina`, how many images to keep, Caddy on/off, HTTPS check | `deploy/ansible/inventory/group_vars/all/main.yml` (defaults; override per host in `hosts.yml`) |

On the server Ansible writes `/opt/malina/docker-compose.yml`, `/opt/malina/deploy/caddy/Caddyfile` and `/opt/malina/.env` (`MALINA_IMAGE`, `MALINA_TAG`, `CADDY_IMAGE`, `MALINA_DOMAIN`, `ACME_EMAIL`, `COMPOSE_PROFILES=caddy`, ports). By hand on the server: `cd /opt/malina && docker compose ps / logs -f / restart`.

## First deploy
```bash
cp deploy/ansible/inventory/hosts.example.yml deploy/ansible/inventory/hosts.yml   # edit
make ansible-ping
make deploy
```

## Notes
- Tag — `git describe --always --dirty`. Uncommitted changes are allowed (with a warning), the `-dirty` image is rebuilt and re-uploaded every time.
- Only what the server lacks travels: a repeated deploy of the same commit copies nothing; a new commit — one malina archive (≈ 90 MB gzip), Caddy only when its version changes.
- Rollback `make deploy TAG=<sha>` works while the server still has that image (`malina_keep_images`, 5). If it does not, the playbook refuses to build the current code under the old tag: check out that commit and deploy from it.
- The current archives stay in `deploy/ansible/.images/` (in .gitignore) for the next server; archives of other builds are removed.
- Several servers of different architectures in one inventory work: the image is built for all needed platforms in one buildx run.
- Own proxy instead of Caddy: `malina_caddy: false` and proxy to `malina_bind:malina_port` with WebSocket upgrade for `/ws`, `/game`.
- A changed Caddyfile is applied with `caddy reload` (compose does not notice it); the directory is mounted, not the file — Ansible replaces the file and a single-file mount would keep the old one.
- `/game` compresses itself (permessage-deflate) — Caddy's `encode` is off for `/ws` and `/game`.
- Dev in Docker: the client on port 5173 looks for the server at `localhost:8787`, with a different `SERVER_PORT` open `?server=http://localhost:<port>`. After changing `package.json` — `--renew-anon-volumes`. The dev DB is in the `malina-dev_data` volume, not `./data`: SQLite WAL locks over a macOS bind mount are unreliable.

## Pitfalls
- A file with mode `600` in the working copy is unreadable for user `node`: the `build` stage runs `chmod -R a+rX` on `server src assets`, `runtime` copies them from there.
- `docker compose down -v` deletes the database and the certificates (`caddy_data`); Let's Encrypt limits re-issuing.
- An empty `ACME_EMAIL` breaks the Caddyfile — `deploy.yml` checks it.
