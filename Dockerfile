# Build stage
FROM debian:12 AS build

ENV NODE_ENV=production

RUN apt-get update && \
	apt-get install -y build-essential curl unzip && \
	curl --proto "=https" --tlsv1.2 -sSf --retry 3 --retry-max-time 30 https://sh.rustup.rs | sh -s -- -y && \
	curl --proto "=https" -fsSL --retry 3 --retry-max-time 30 https://bun.sh/install | bash

ENV PATH="/root/.cargo/bin:${PATH}"
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

WORKDIR /build

COPY tsconfig.json ./
COPY package.json ./
COPY init-db.ts ./
COPY bunfig.toml ./
COPY src ./src/
COPY .env.production ./.env
COPY Cargo.lock ./
COPY Cargo.toml ./

RUN cargo test --workspace && \
	cargo build --release && \
	cp ./target/release/libtar.so /usr/local/lib/ && \
	bun install --production && \
	mkdir .database && \
    bun run init-db.ts && \
    bun test --timeout 15000 && \
	rm -rf .database/* && \
    bun run init-db.ts && \
    bun build --compile --minify --sourcemap ./src/main.ts --outfile ./tasks

# Nix store stage
FROM nixos/nix AS nix-store

ARG TAR

ENV NIXPKGS_ALLOW_UNFREE=1
ENV TAR=$TAR

COPY src/nixpkgs/default.nix /tmp/default.nix

RUN mkdir -p /output/store && \
	nix-channel --update && \
	nix-env --profile /output/profile -i -f /tmp/default.nix && \
	cp -a $(nix-store -qR /output/profile) /output/store && \
	nix-collect-garbage && \
	nix-collect-garbage -d

# Final stage
FROM gcr.io/distroless/base-debian12:nonroot

LABEL maintainer="Reyhan Kamil <mail@ryhkml.dev>"

ARG PORT

ENV NODE_ENV=production

WORKDIR /home/nonroot/app

COPY --from=nix-store --chown=nonroot:nonroot /output/store /nix/store
COPY --from=nix-store --chown=nonroot:nonroot /output/profile/ /usr/local/
COPY --from=build --chown=nonroot:nonroot /build/tasks /usr/local/bin/
COPY --from=build --chown=nonroot:nonroot /build/.database /home/nonroot/app/.database/
COPY --from=build --chown=nonroot:nonroot /build/target/release/libtar.so /usr/local/lib/
COPY --chown=nonroot:nonroot tls /home/nonroot/app/tls/

EXPOSE $PORT/tcp

CMD ["tasks"]