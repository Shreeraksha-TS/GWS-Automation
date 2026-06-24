# ── Stage 1: build the React frontend ────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build                  # outputs to /frontend/dist

# ── Stage 2: Node API (run via tsx, no build step) ───────────────
FROM node:20-alpine AS api
WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY common/ ./common/             # store.ts, records.ts, jobqueue.ts, types.ts
COPY backend/ ./backend/           # server.ts, routes/, services/, etc.
COPY --from=frontend-builder /frontend/dist /app/static
RUN mkdir -p /app/reports /app/data /app/scripts
ENV STATIC_DIR=/app/static
CMD ["npx", "tsx", "backend/server.ts"]
