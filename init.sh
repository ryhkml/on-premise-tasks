#!/usr/bin/env bash

set -e

bun -v

cat <<EOF >.env
TZ="UTC"
PORT=
PATH_SQLITE="./db/tasks.db"
EOF

echo ".env file created"

bun install
bun init-db.ts
bun test

echo "On-Premise Tasks is ready to serve"