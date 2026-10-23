# One image recipe for every Node service; pick it with --build-arg SERVICE=<project>.
#   docker build -f infra/docker/node-service.Dockerfile --build-arg SERVICE=svc-review .
FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci
ARG SERVICE
RUN npx nx build ${SERVICE} --skip-nx-cache && npm prune --omit=dev

FROM node:22-slim
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/libs ./libs
COPY --from=build /repo/apps/${SERVICE} ./apps/${SERVICE}
WORKDIR /repo/apps/${SERVICE}
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
