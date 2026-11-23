# Multi-stage production Dockerfile for Google Cloud Run
FROM node:22-slim AS builder

WORKDIR /app

# Build dependencies for better-sqlite3 native module if needed
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV CAMPUS_TIMEZONE=Asia/Kolkata

# Create non-root user for Cloud Run security
RUN groupadd --system --gid 1001 lablink && \
    useradd --system --uid 1001 --gid lablink lablink

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/data && chown -R lablink:lablink /app

USER lablink

EXPOSE 8080

CMD ["node", "server.ts"]
