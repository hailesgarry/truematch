# Frontend Deployment Guide

This Vite/React frontend is configured to deploy on Netlify and consume the hosted backend services running on Render.

## Build Commands

- `npm run build` generates the production bundle (Netlify runs this automatically).
- `npm run dev` serves the app locally with hot reloading.

## Required Environment Variables

The app relies on Vite-prefixed variables so they are inlined at build time:

- `VITE_API_URL` – REST endpoints from the Node service (`https://truematch-node-service.onrender.com/api`).
- `VITE_PY_API_URL` – REST endpoints from the Python service (`https://truematch-python-service.onrender.com/api`).
- `VITE_SOCKET_URL` – Socket.IO origin (`https://truematch-node-service.onrender.com`).
- `VITE_VAPID_PUBLIC_KEY` – Public Web Push key (matches the private key defined in the Python service).

On Netlify these are declared in `netlify.toml`, but you can override them in the Netlify UI if needed. For local development, create a `.env` file in this folder and set any values that differ from the defaults.

## Netlify Deployment Steps

1. Push the repository so Netlify can access it.
2. In Netlify, create a **New site from Git** and select this repository.
3. Netlify automatically reads `netlify.toml`:
   - Build command: `npm run build` (runs icon/logo generators first).
   - Publish directory: `frontend/dist`.
   - Node runtime pinned to 20.x.
   - Backend URLs wired to the Render services.
4. Click **Deploy site**. Subsequent pushes to `main` will trigger new deploys.

### Optional Configuration

- **Preview deploys**: Enable Deploy Previews in Netlify to review pull requests.
- **Custom domain**: Add your domain in Netlify and configure DNS. HTTPS is provided automatically.
- **Environment overrides**: For staging or preview builds, set different `VITE_*` values in the Netlify UI (Site settings → Environment variables → Deploy contexts).

## Local Testing Before Deploy

```bash
cd frontend
npm install
npm run build
npm run preview
```

Preview serves the production bundle locally so you can verify API connectivity against the Render backends before deploying.
