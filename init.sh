#!/usr/bin/env bash

set -e

# Must be installed bun
bun -v
# Must be installed rustc
rustc --version

cat .env.example > .env.development
echo ".env.development file has been created"

cat .env.example > .env.production
echo ".env.production file has been created"

bun install
echo "Done!"