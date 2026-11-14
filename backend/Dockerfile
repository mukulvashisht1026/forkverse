FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
# MIGRATE_ON_START=false skips migrate, e.g. demo mode (TIMELINE_MOCK=true) without a reachable MongoDB.
ENV MIGRATE_ON_START=true
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_START\" != \"false\" ]; then node dist/src/db/migrate.js || exit 1; fi; exec node dist/src/server.js"]
