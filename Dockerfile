FROM node:22.22.2-bookworm-slim AS dependencies
WORKDIR /app
ARG BUILD_CPUSET=0,1
COPY package.json package-lock.json ./
RUN taskset -c "$BUILD_CPUSET" npm ci --no-audit --no-fund

FROM dependencies AS build
ARG BUILD_CPUSET=0,1
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN taskset -c "$BUILD_CPUSET" npm run build

FROM node:22.22.2-bookworm-slim AS runtime
WORKDIR /app
ARG BUILD_CPUSET=0,1
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY package-lock.json ./
RUN taskset -c "$BUILD_CPUSET" npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
