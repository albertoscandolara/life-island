# The pages the gateway serves: production builds of the shell, the documents app and
# every area, put in place by infra/site/assemble.mjs. The container copies them into
# the `site` volume and exits.
FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci
RUN npm run site:build

FROM busybox:1.37
COPY --from=build /repo/dist/site /site
CMD ["sh", "-c", "rm -rf /srv/* && cp -r /site/. /srv/ && echo 'site: pages copied'"]
