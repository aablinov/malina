# Deploy: Docker, Caddy and Ansible

> Version 4 · 2026-11-07

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
| `deploy/ansible/playbooks/provisioning.yml` + `bin/copy-ssh-key.sh` | Once per fresh server: the ssh key to root (ssh-copy-id, asks the password), Docker from Docker's apt repository, user `deploy`, ssh by key only, ufw, automatic security updates |
| `deploy/ansible/playbooks/deploy.yml` | `push.yml`, then files to `/opt/malina`, `compose up --wait`, health checks, old images removed (the last 5 stay) |

## Make targets
| Target | What it does |
|---|---|
| `make docker-dev` | Development in Docker: http://localhost:5173, server :8787 |
| `make image-build` | Production image for this machine, tags `malina:<commit>` and `malina:local` |
| `make image-run` / `image-stop` | That image with Caddy at https://localhost:8443 (Caddy's local CA — `curl -k`, the browser warns) |
| `make image-push` | Build for the servers' platform and upload what they lack, containers untouched |
| `make provisioning` | Prepare a fresh server (see below); `LIMIT=<host>`, `ASK_BECOME=1` if sudo asks a password |
| `make ansible-ping` | ssh to the servers works |
| `make ansible-check` | Dry run of the deploy with a diff of `docker-compose.yml`, `.env`, `Caddyfile` |
| `make ansible-deploy` (= `make deploy`) | `image-push` + compose up + checks; rollback: `TAG=<sha>` |
| `make ansible-vault` | Create (from `vault.example.yml`, `$EDITOR`, encrypt) or edit the vault |
| `make ansible-logs` | Last 100 lines of the server logs |

Extra Ansible arguments — `ARGS='-e malina_check_https=false'`, one server — `LIMIT=malina-prod`, another inventory file — `INVENTORY=inventory/staging.yml`. Vault password: the file `deploy/ansible/.vault-pass` if it exists, else Ansible asks (only when the vault is encrypted).

## What to prepare
**Domain.** An A (and AAAA, if the server has IPv6) record of the game's domain → the server IP. Without it Let's Encrypt will not issue a certificate.

**Server**: a fresh Debian 12+/Ubuntu 22.04+, amd64 or arm64, 1 vCPU / 1 GB is enough, ~2 GB disk for images, root login by password or key (what VPS providers give). Everything else is `make provisioning`.

**This machine.** Docker with buildx and the **containerd image store** (Docker Desktop: Settings → General → "Use containerd for pulling and storing images", on by default in new installs) — needed for `docker save --platform` and building for another architecture; Ansible; an ssh key (`ssh-keygen -t ed25519` if there is none).

## Where the settings go
| What | Where |
|---|---|
| Server address, ssh port/key, `provision_user` (if not root), `malina_domain`, `acme_email` | `deploy/ansible/inventory/hosts.yml` (copy of `hosts.example.yml`, not in git) |
| Secrets (sudo password, if ever needed) | `deploy/ansible/inventory/group_vars/all/vault.yml` — `make ansible-vault`, not in git; nothing is needed there today |
| Vault password | `deploy/ansible/.vault-pass` (one line, `chmod 600`, not in git) — or type it every time |
| Deploy user, extra ssh keys (`ssh_extra_public_keys`), root login policy, Docker apt mirror, ufw on/off, image name, Caddy version, ports, `/opt/malina`, how many images to keep, Caddy on/off, HTTPS check | `deploy/ansible/inventory/group_vars/all/main.yml` (defaults; override per host in `hosts.yml`) |

On the server Ansible writes `/opt/malina/docker-compose.yml`, `/opt/malina/deploy/caddy/Caddyfile` and `/opt/malina/.env` (`MALINA_IMAGE`, `MALINA_TAG`, `CADDY_IMAGE`, `MALINA_DOMAIN`, `ACME_EMAIL`, `COMPOSE_PROFILES=caddy`, ports). By hand on the server: `cd /opt/malina && docker compose ps / logs -f / restart`.

## Provisioning (`make provisioning`)
1. `bin/copy-ssh-key.sh`: for every server tries `ssh root@host` by key; if that fails — `ssh-copy-id` with this machine's key (`~/.ssh/id_ed25519.pub`, `id_ecdsa.pub` or `id_rsa.pub`; `SSH_KEY=` for another), the server asks the root password once.
2. `provisioning.yml` as `provision_user` (root): base packages, Docker Engine + compose plugin from `docker_apt_url`; user `deploy_user` (`deploy`) in group `docker`, sudo without a password, the same key (+ `ssh_extra_public_keys`); `/opt/malina` owned by it.
3. Checks from this machine that `deploy` logs in by key and runs docker — only then ssh is switched to keys only: `/etc/ssh/sshd_config.d/00-malina.conf` (`PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`; `00-` beats cloud-init's `50-cloud-init.conf`), validated with `sshd -t`.
4. ufw: the ports sshd really listens on (`sshd -T`), 80/tcp, 443/tcp, 443/udp, everything else in — denied. Automatic security updates (`unattended-upgrades`).
5. After the ssh restart it checks that a password is refused ("Permission denied (publickey)").

Safe to run again (nothing changes). Root stays reachable by key, so a repeated provisioning works; with `ssh_permit_root_login: "no"` provision as the deploy user: `make provisioning ARGS='-e provision_user=deploy'`. Clouds that give a sudo user instead of root (`ubuntu`, `debian`) — `provision_user` in `hosts.yml`, plus `ASK_BECOME=1` if its sudo asks a password. If `download.docker.com` is unreachable from the server — `docker_apt_url` to a mirror with the same layout.

## First deploy
```bash
cp deploy/ansible/inventory/hosts.example.yml deploy/ansible/inventory/hosts.yml   # edit
make provisioning
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
