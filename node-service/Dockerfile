# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY node-service/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY node-service/. ./
EXPOSE 8080
CMD ["node", "server.js"]
