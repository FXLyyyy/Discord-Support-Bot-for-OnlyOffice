# syntax=docker/dockerfile:1.7
# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Cache-mount the npm download cache so repeat builds skip re-fetching tarballs.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# pg_dump for scheduled database backups (client >= server is fine)
RUN apk add --no-cache postgresql-client
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/logs
# Env is injected by docker-compose, so no --env-file here.
CMD ["node", "dist/index.js"]
