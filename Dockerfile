# ==============================================================================
# DIM PLATFORM - DOCKERFILE UNIVERSAL PARA EASYPANEL E VPS
# ==============================================================================

FROM node:24.11.1-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build -w @dim/web

# ------------------------------------------------------------------------------
# Target: web (caso seja especificado --target web)
# ------------------------------------------------------------------------------
FROM node:24.11.1-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ------------------------------------------------------------------------------
# Target: api (caso seja especificado --target api)
# ------------------------------------------------------------------------------
FROM build AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]

# ------------------------------------------------------------------------------
# Target: worker (caso seja especificado --target worker)
# ------------------------------------------------------------------------------
FROM build AS worker
WORKDIR /app
ENV NODE_ENV=production
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node --import tsx scripts/worker-health.ts
CMD ["node", "--import", "tsx", "apps/worker/src/main.ts"]

# ------------------------------------------------------------------------------
# Target Padrão (Executado quando o Easypanel faz build do Dockerfile da raiz)
# Controlado via SERVICE_ROLE: web (default), api, worker ou all
# ------------------------------------------------------------------------------
FROM build AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV HOSTNAME=0.0.0.0
ENV SERVICE_ROLE=all
ENV API_INTERNAL_URL=http://127.0.0.1:3001

# Garante a estrutura do standalone do Next.js
RUN cp -rn /app/apps/web/.next/standalone/* /app/ 2>/dev/null || true
RUN cp -rn /app/apps/web/.next/static /app/apps/web/.next/static 2>/dev/null || true

EXPOSE 3000 3001

CMD ["node", "scripts/docker-entrypoint.mjs"]
