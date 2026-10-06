# syntax=docker/dockerfile:1
#
# LogiFlow SPA — build the Vite bundle, serve it from nginx.
#
# The bundle calls the API with *relative* /api/v1 paths (src/api/client.ts), so
# nginx serves the static assets and reverse-proxies /api to the API service.
# That keeps the browser on one origin: no CORS, and no build-time API URL to bake in.

FROM node:22-alpine AS build
WORKDIR /app

# Manifest-only layer so `npm ci` is cached until dependencies actually change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# 127.0.0.1, not "localhost": busybox wget resolves localhost to ::1 first, but the
# nginx server block listens on IPv4 only, so that probe fails with "connection refused".
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]