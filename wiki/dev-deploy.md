# Deploy: Docker and Ansible

> Version 1 · 2026-11-05

One image runs the whole game: `node server/main.ts` serves the built `dist/index.html` at `/` and the API at `/api`, `/ws`, `/game` (see [design-multiplayer.md](design-multiplayer.md)). SQLite lives in the `/data` volume.

## Files
| File | What it is |
|---|---|
| `Dockerfile` | Stages: `deps` (npm ci) → `dev` (for compose dev) / `build` (tsc + vite) → `prod-deps` → `runtime` (user `node`, healthcheck on `/api/health`) |
| `docker-compose.dev.yml` | `server` (`node --watch`) and `client` (Vite) with sources mounted; node_modules and the DB in volumes |
| `docker-compose.prod.yml` | One `malina` container, image `${MALINA_IMAGE}:${MALINA_TAG}`, volume `data`, port `${MALINA_BIND}:${MALINA_PORT}` |
| `deploy/ansible/` | `build.yml` — buildx multi-platform build and push; `deploy.yml` — compose up on the servers; `site.yml` — both |

## Development in Docker
```bash
make docker-dev        # = docker compose -f docker-compose.dev.yml up --build
```
Game — http://localhost:5173, server — http://localhost:8787. The client on port 5173 looks for the server at `localhost:8787`, so with a different `SERVER_PORT` open the game with `?server=http://localhost:<port>`. After changing `package.json` add `--renew-anon-volumes` (or `docker volume rm malina-dev_node_modules`). The dev DB is in the `malina-dev_data` volume, not `./data`: SQLite WAL locks over a macOS bind mount are unreliable.

## Build, push, deploy
Once: `cd deploy/ansible`, copy `inventory/hosts.example.yml` → `inventory/hosts.yml` (server address, ssh user); for a private image copy `vault.example.yml` → `inventory/group_vars/all/vault.yml` and `ansible-vault encrypt` it. On this machine — `docker login ghcr.io`. Run playbooks from `deploy/ansible` (that is where `ansible.cfg` is).

```bash
ansible-playbook playbooks/build.yml     # image :<git sha> and :latest, linux/amd64 + linux/arm64
ansible-playbook playbooks/deploy.yml    # pull, up -d --wait, check /api/health, prune old images
ansible-playbook playbooks/site.yml      # both
ansible-playbook playbooks/deploy.yml -e malina_tag=<old sha>   # rollback
```
- Tag — `git describe --always --dirty` of the working copy; with uncommitted changes the build refuses to push `:latest` (allow with `-e malina_push_latest=false`).
- One platform builds much faster: `-e '{"malina_platforms": ["linux/amd64"]}'`.
- Build cache goes to `<image>:buildcache` in the registry; `-e malina_cache_ref=` turns it off.
- All knobs — `deploy/ansible/inventory/group_vars/all/main.yml`.
- The server needs docker with the compose plugin, the ssh user in the `docker` group. Files go to `/opt/malina` (`docker-compose.yml` + `.env`).
- TLS is not part of it: put Caddy / nginx in front and proxy to `malina_bind:malina_port` with WebSocket upgrade (`/ws`, `/game`); then set `malina_bind: 127.0.0.1`.

## Pitfalls
- A file with mode `600` in the working copy is unreadable for user `node`: the `build` stage runs `chmod -R a+rX` on `server src assets`, `runtime` copies them from there.
- `docker compose down -v` deletes the volume with the database.
