# Food delivery app: Express API (backend/) + static frontend (frontend/).
# server.js serves ../frontend relative to backend/, so both folders live side by side.
FROM node:20-alpine

WORKDIR /app

# Install dependencies first so this layer is cached between code changes.
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

WORKDIR /app/backend
CMD ["node", "server.js"]
