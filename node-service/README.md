## Environment Variables

| Name                  | Description                                     | Default                   |
| --------------------- | ----------------------------------------------- | ------------------------- |
| PORT                  | Port for Express/Socket.IO server               | 8080                      |
| CORS_ORIGIN           | Allowed CORS origin                             | \*                        |
| PY_API_URL            | Base URL for Python FastAPI service             | http://localhost:8081/api |
| PY_API_CB_THRESHOLD   | Consecutive write failures before circuit opens | 3                         |
| PY_API_CB_COOLDOWN_MS | Milliseconds circuit remains open before retry  | 15000                     |

### Circuit Breaker & Timeouts

Writes to the Python service (send/edit/delete/reactions) use a circuit breaker:

1. After `PY_API_CB_THRESHOLD` consecutive failures, further write attempts short‑circuit and return lightweight fallbacks.
2. After `PY_API_CB_COOLDOWN_MS` the breaker resets and real attempts resume.
3. Read (GET) requests use a shorter 6s timeout with up to 2 idempotent retries + jitter; writes use a 10s timeout.

This protects the socket loop from cascading long Axios ECONNABORTED timeouts when the Python or Mongo layer experiences transient latency.

# RandomMe Backend

## Local Development

1. Copy `.env.example` to `.env` and fill in your secrets.
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```

## Deployment

### 1. Push to GitHub

- Initialize git and push your code:
  ```
  git init
  git add .
  git commit -m "Initial commit"
  git remote add origin <your-repo-url>
  git push -u origin main
  ```

### 2. Deploy on Render

- Go to [Render](https://render.com/), create a new Web Service, and connect your GitHub repo.
- Set the root directory to `backend`.
- Set environment variables in the Render dashboard (do **not** commit secrets).
- Render will use `npm install` and `npm start` by default (as set in `render.yaml`).
