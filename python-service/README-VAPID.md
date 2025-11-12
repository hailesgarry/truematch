# Web Push VAPID setup

This service uses VAPID keys to authenticate Web Push messages. You need a public and private key pair.

You can generate keys either with Node.js (web-push) or Python (pywebpush).

## Option A: Node.js (web-push)

1. Install web-push globally or use npx:

```powershell
# Generate keys (Windows PowerShell)
npx web-push generate-vapid-keys --json
```

2. Output example:

```
{
  "publicKey": "BAbC...",
  "privateKey": "2h5F..."
}
```

3. Copy these to `python-service/.env`:

```
VAPID_PUBLIC_KEY=BAbC...
VAPID_PRIVATE_KEY=2h5F...
VAPID_SUBJECT=mailto:you@example.com
```

## Option B: Python (pywebpush + cryptography)

Create a short Python script and run it inside your Python environment:

```python
from pywebpush import generate_vapid_key_pair
public_key, private_key = generate_vapid_key_pair()
print('VAPID_PUBLIC_KEY=', public_key)
print('VAPID_PRIVATE_KEY=', private_key)
```

Run it (example using python -c):

```powershell
python -c "from pywebpush import generate_vapid_key_pair; pub,priv=generate_vapid_key_pair(); print('VAPID_PUBLIC_KEY='+pub); print('VAPID_PRIVATE_KEY='+priv)"
```

Then place the results in `python-service/.env` and restart the server.

## Frontend configuration

- The frontend can either:
  - Use `VITE_VAPID_PUBLIC_KEY` in `frontend/.env`, or
  - Fetch it at runtime from `GET /api/push/public-key` (already supported in the code).

Example `frontend/.env`:

```
VITE_VAPID_PUBLIC_KEY=BAbC...
```

If `VITE_VAPID_PUBLIC_KEY` is missing, the client will request the public key from the backend.

## Testing push

1. Ensure at least one client has subscribed:
   - In the app, call `subscribeUserToPush()` from a settings toggle or on-demand action, then `registerSubscriptionOnServer()`.

2. Send a test notification:
   - POST to `http://localhost:8081/api/push/test` with body:

```json
{
  "title": "Funly",
  "body": "Push works!",
  "url": "/inbox"
}
```

A notification should appear on subscribed clients.
