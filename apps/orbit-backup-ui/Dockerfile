FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV APP_DATA_DIR=/data
ENV ORBIT_BACKUP_STATE_FILE=/data/state.json
ENV LONGHORN_NAMESPACE=storage

RUN addgroup -S nextjs && adduser -S -u 1001 -G nextjs nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /data && chown -R nextjs:nextjs /data /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
