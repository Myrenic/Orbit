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

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV APP_DATA_DIR=/data
ENV ORBIT_BACKUP_STATE_FILE=/data/state.json
ENV LONGHORN_NAMESPACE=storage

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && wget -q https://enterprise.proxmox.com/debian/proxmox-release-bookworm.gpg -O /etc/apt/trusted.gpg.d/proxmox-release-bookworm.gpg \
  && echo "deb http://download.proxmox.com/debian/pbs-client bookworm main" > /etc/apt/sources.list.d/pbs-client.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends proxmox-backup-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system nextjs \
  && useradd --system --uid 1001 --gid nextjs nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /data && chown -R nextjs:nextjs /data /app

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
