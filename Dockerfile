# Build stage
FROM oven/bun:debian AS build

WORKDIR /app

COPY tsconfig.json ./
COPY package.json ./
COPY init-db.ts ./
COPY bunfig.toml ./
COPY bun.lockb ./
COPY src ./src/
COPY .env.production ./

RUN bun install --frozen-lockfile --production && \
    mkdir db && \
    bun --env-file=.env.production run init-db.ts && \
    bun --env-file=.env.production test --timeout 10000 && \
    bun --env-file=.env.production run init-db.ts && \
    bun build --compile --minify --sourcemap ./src/main.ts --outfile ./tasks

# Final stage
FROM gcr.io/distroless/base-debian12

LABEL maintainer="Reyhan Kamil <mail@ryhkml.dev>"

ARG PORT

WORKDIR /app

COPY --from=build /app/db ./db/
COPY --from=build /app/tasks ./

EXPOSE $PORT/tcp

CMD ["/app/tasks"]