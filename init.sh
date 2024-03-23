#!/usr/bin/env bash

set -e

bun -v

cat <<EOF >.env
TZ="UTC"
PORT=
LEVEL="DEV" # Comment this for production usage
PATH_SQLITE="./db/tasks.sqlite"
PATH_TEST_SQLITE="./db/test/tasks.sqlite"
EOF

echo ".env file created"

bun install
bun init-db.ts test
bun test

echo "On-Premise Tasks is ready to serve"