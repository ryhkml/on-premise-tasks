#!/usr/bin/env bash

set -e

bun -v

cat <<EOF >.env
TZ="UTC"
LOG=1 # 1 = TRUE, 0 = FALSE
PORT=
LEVEL="DEV" # Comment this for production usage
PATH_SQLITE="./db/tasks.sqlite"
PATH_TEST_SQLITE="./db/test/tasks.sqlite"
EOF

echo ".env file created"

bun install
bun init-db.ts test
bun test --timeout 10000

echo "On-Premise Tasks is ready to serve"