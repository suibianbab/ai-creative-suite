# Development VM infrastructure

The VM connection details are in the local, Git-ignored development pack `info.txt`. Do not copy them into source files or commit them.

## Deployed stack

The isolated Compose project `acs` uses [`deploy/compose.vm.yaml`](../deploy/compose.vm.yaml), copied to `/opt/ai-creative-suite/compose.vm.yaml` on the VM. It runs PostgreSQL 17, Redis 7, and the cached RustFS S3-compatible object store. The original [`compose.yaml`](../compose.yaml) remains the generic local MinIO configuration.

A separate development-only `acs-auth` project now runs Keycloak 26.8.0 from [`deploy/compose.auth.vm.yaml`](../deploy/compose.auth.vm.yaml). It binds only `127.0.0.1:8180` on the VM and has its own data volume. The test realm is `acs-dev`; its bootstrap, client, and test-user credentials are in the Git-ignored `.env.auth.local` on this workstation and restricted files under `/opt/ai-creative-suite/` on the VM. Do not copy those files into source control. The realm uses `start-dev` and a direct password grant client solely for internal integration testing, not as a production login setup.

All VM ports bind to `127.0.0.1`, so they are reachable only from the VM or through an SSH tunnel. The S3 bucket `acs-local` has been created. These credentials and services are for development only.

## Verified on 2026-10-08

- `docker compose ... config --quiet`: passed.
- PostgreSQL `pg_isready -U acs -d acs`: accepting connections.
- Redis `redis-cli ping`: `PONG`.
- RustFS `GET /health`: HTTP 200.
- S3 bucket create, object write, read and delete: passed with MinIO Client.
- Local SSH tunnel to all four VM loopback ports: passed.
- API `/health/ready` through the tunnel: HTTP 200; PostgreSQL, Redis, and object store all `ok`.
- API without dependency configuration: HTTP 503 with all checks `unconfigured`.

## Access from the workstation

Forward ports over SSH when the application needs to connect to the VM. Replace `<VM-IP>` with the address in the ignored `info.txt`:

```bash
ssh -N -L 5432:127.0.0.1:5432 -L 6379:127.0.0.1:6379 -L 9000:127.0.0.1:9000 -L 9001:127.0.0.1:9001 -L 8180:127.0.0.1:8180 root@<VM-IP>
```

On Windows, [`scripts/vm_tunnel.py`](../scripts/vm_tunnel.py) can open the same loopback forwards using `info.txt`. Install `paramiko` in a local Python environment, then run `python scripts/vm_tunnel.py`. It verifies the saved SSH host key and does not print the password.
The tunnel now sends SSH keepalives and replaces a disconnected SSH transport while keeping its local listeners. QA preflight checks the actual PostgreSQL, RustFS and Keycloak responses; an open local port alone does not prove the VM services are reachable.

Copy `.env.example` to `.env` locally. The URLs in that file assume the SSH tunnel is active. The object store API is on port 9000; its console is on 9001.

After `pnpm build`, run `node --env-file=.env apps/api/dist/main.js` from the repository root and open `http://localhost:4000/health/ready`. Keep the tunnel process running while using these services.

## Operations

On the VM, use the dedicated project and file so other running containers are unaffected:

```bash
docker compose -p acs -f /opt/ai-creative-suite/compose.vm.yaml ps
docker compose -p acs -f /opt/ai-creative-suite/compose.vm.yaml up -d
```

For development OIDC, use [`scripts/setup_vm_auth.py`](../scripts/setup_vm_auth.py) after the pinned Keycloak image is available on the VM. This run exported the official image on the workstation and loaded it with [`scripts/load_vm_auth_image.py`](../scripts/load_vm_auth_image.py) because the VM timed out downloading image layers. The proxy manifest was compared with the official manifest and matched. Then run `node --env-file=../../.env --import tsx src/auth/keycloak-provision.ts` once from `apps/api` if an existing imported test user lacks profile fields, and `node --env-file=../../.env --import tsx src/auth/keycloak-smoke.ts` for the real-token authorization check. The workstation SSH tunnel must include port 8180. Keycloak's local discovery URL is `http://localhost:8180/realms/acs-dev/.well-known/openid-configuration`.

The pinned MinIO image in the generic Compose file could not be pulled on this VM: Docker Hub timed out and Quay denied access. RustFS is a development fallback; any production storage choice needs its own compatibility and operational review. [RustFS Docker documentation](https://docs.rustfs.com/en/installation/container/docker.html) describes its S3 API and health endpoint.
