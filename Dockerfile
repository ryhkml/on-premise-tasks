# Build stage
FROM rockylinux:9 AS build

ENV NODE_ENV=production

RUN dnf install cmake gcc make clang unzip -y && \
	curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
	curl -fsSL https://bun.sh/install | bash

WORKDIR /app

COPY tsconfig.json ./
COPY package.json ./
COPY init-db.ts ./
COPY bunfig.toml ./
COPY bun.lockb ./
COPY src ./src/
COPY .env.production ./.env
COPY Cargo.lock ./
COPY Cargo.toml ./

RUN export PATH="$HOME/.cargo/bin:$PATH" && \
	export BUN_INSTALL="$HOME/.bun" && \
	export PATH="$BUN_INSTALL/bin:$PATH" && \
	cargo build --release && \
	bun install --production && \
	cd /usr/local/lib && \
	ln -s /app/target/release/libtar.so && \
	cd /app && \
	cargo test --workspace && \
	mkdir db && \
    bun run init-db.ts && \
    bun test --timeout 15000 && \
	rm -rf ./db/* && \
    bun run init-db.ts && \
    bun build --compile --minify --sourcemap ./src/main.ts --outfile ./tasks

# Final stage
FROM rockylinux:9-minimal

LABEL maintainer="Reyhan Kamil <mail@ryhkml.dev>"

ARG PORT

RUN groupadd -g 1000 app && \
    useradd -g app -u 1000 -ms /bin/bash app

WORKDIR /home/app

COPY --from=build --chown=app:app /app/db ./db/
COPY --from=build --chown=app:app /app/tasks ./
COPY --from=build --chown=app:app /app/target/release/libtar.so ./target/release/libtar.so

RUN cd /usr/local/lib && \
	ln -s /home/app/target/release/libtar.so

USER app

EXPOSE $PORT/tcp

CMD ["/home/app/tasks"]