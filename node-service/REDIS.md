# Redis usage

Redis is used for two purposes:

1. Socket.IO adapter (pub/sub) to scale the Node websocket server horizontally.
2. Application caching and pub/sub in the Python FastAPI service (for message windows, presence proxy, and groups list).

Environment variables:

- REDIS_URL: redis connection string (e.g., redis://localhost:6379/0)
- PY_API_URL: base URL of the Python service (used by node-service adapters)

How it works:

- node-service: If REDIS_URL is set, Socket.IO uses the Redis adapter.
- python-service: If REDIS_URL is set, common queries are cached in Redis with short TTLs. On message writes/edits/deletes and group mutations, the service publishes a cache:invalidate message with a key prefix; a background subscriber deletes keys by prefix.

This setup is optional; the app runs without Redis, but enabling it improves performance under load.
