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
