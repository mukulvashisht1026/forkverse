# Production frontend: static Vite build served by nginx on :80.
# API/WebSocket URLs stay relative (/api, /ws); Caddy routes them to the backend on the same domain.
# (Imports from ../contracts are type-only and erased by Vite, so the context can stay frontend/.)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx vite build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
