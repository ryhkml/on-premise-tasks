#!/usr/bin/env bash

set -e

bun -v

cat <<EOF >.env
TZ="UTC"
PATH_SQLITE="./db/t.sqlite"
EOF

echo ".env file created"

bun install
bun run src/db.ts
bun test

echo "On-Premise Tasks is ready to serve"