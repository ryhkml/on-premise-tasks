# Build stage
FROM debian:12 AS build

ARG PATH_SQLITE

ENV TZ=UTC
ENV PATH_SQLITE=$PATH_SQLITE

WORKDIR /app

COPY tsconfig.json ./
COPY package.json ./
COPY init-db.ts ./
COPY bun.lockb ./
COPY src ./src/

RUN apt update && \
    apt install curl unzip -y && \
    curl https://bun.sh/install | bash && \
    /root/.bun/bin/bun install --frozen-lockfile --production && \
    mkdir db && \
    /root/.bun/bin/bun run init-db.ts && \
    /root/.bun/bin/bun test && \
    rm -rf ./db/tasks.* && \
    /root/.bun/bin/bun run init-db.ts && \
    /root/.bun/bin/bun build --compile --minify --sourcemap ./src/main.ts --outfile ./tasks

# Final stage
FROM gcr.io/distroless/base-debian12

ARG PORT
ARG PATH_SQLITE

LABEL maintainer="Reyhan Kamil <mail@ryhkml.dev>"

ENV TZ=UTC
ENV PORT=$PORT
ENV PATH_SQLITE=$PATH_SQLITE

WORKDIR /app

COPY --from=build /app/db ./db/
COPY --from=build /app/tasks ./

EXPOSE $PORT

CMD ["./tasks"]