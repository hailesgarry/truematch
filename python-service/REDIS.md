# Redis in python-service

When `REDIS_URL` is defined, the FastAPI service enables:

- Caching for:
  - `/api/groups` list (30s TTL, no online counts)
  - Presence proxy `/api/groups/online-counts` (TTL from ONLINE_COUNTS_TTL)
  - Message latest windows `/api/messages/{group}/latest` (15s TTL)
- Pub/Sub for cache invalidation: on message create/edit/delete and group changes, the service publishes `cache:invalidate` with a key prefix. A background task subscribes and deletes keys with that prefix using SCAN.

Env vars:

- `REDIS_URL=redis://localhost:6379/0`
- `ONLINE_COUNTS_TTL=5`
- `ACTIVE_USERS_TTL=5`

The service will run without Redis; caching is best-effort.

## Local setup on Windows

You have a few good options; Docker is the simplest and most consistent:

1. Using Docker Desktop (recommended)

- Install Docker Desktop for Windows.
- Start Redis 7 locally:

  Powershell:
  docker run --name tm-redis -p 6379:6379 -d redis:7-alpine

- Verify: docker logs tm-redis; it should show "Ready to accept connections".
- Set `REDIS_URL=redis://localhost:6379/0` in `python-service/.env` and restart the FastAPI server.

2. Using WSL (Ubuntu)

- Install WSL and Ubuntu from the Microsoft Store.
- In the Ubuntu shell:

  sudo apt update && sudo apt install -y redis-server
  sudo service redis-server start

- From Windows, connect via `redis://localhost:6379/0` (WSL forwards localhost).

3. Native Windows build

- Use Memurai (Redis-compatible for Windows) if you prefer a native service: https://www.memurai.com/
- Configure it to listen on 6379, then use `REDIS_URL=redis://localhost:6379/0`.

## Verifying connectivity

- Start the FastAPI service and hit `GET /api/health/redis`: it returns `{ "redis": "connected" }` when OK.
- Trigger data changes (create/edit/delete message, update groups) and observe the server log:
  you should see the Redis subscriber start line and invalidation actions.

## Node service

The Node `socket.io` server is already wired to use the Redis adapter when `REDIS_URL` is set in its environment.
Using the same Redis instance enables multi-process fanout for real-time events.
