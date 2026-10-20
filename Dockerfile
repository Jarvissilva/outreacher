# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
COPY packages packages
RUN pnpm build
RUN pnpm --filter @outreachit/server --prod deploy --legacy /runtime
FROM node:22.22.0-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build /runtime/ ./
COPY --from=build /app/apps/server/dist/ ./apps/server/dist/
COPY --from=build /app/apps/client/dist/ ./apps/client/dist/
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
