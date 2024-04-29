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

RUN apt update && \
	apt upgrade && \
	apt install -y curl && \
	bun install --frozen-lockfile --production && \
    mkdir db && \
    bun --env-file=.env.production run init-db.ts && \
    bun --env-file=.env.production test --timeout 10000 && \
    bun --env-file=.env.production run init-db.ts && \
    bun build --compile --target=bun-linux-x64 --minify --sourcemap ./src/main.ts --outfile ./tasks

# Final stage
FROM rockylinux:9-minimal

LABEL maintainer="Reyhan Kamil <mail@ryhkml.dev>"

ARG PORT

RUN groupadd -g 1000 app && \
    useradd -g app -u 1000 -ms /bin/bash app

WORKDIR /home/app

COPY --from=build --chown=app:app /app/db ./db/
COPY --from=build --chown=app:app /app/tasks ./

USER app

EXPOSE $PORT/tcp

CMD ["/home/app/tasks"]