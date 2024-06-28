#!/usr/bin/env bash

set -e

NORMAL="\033[0m"
ERROR="\033[0;31m"

error() {
	local message="${ERROR}$1${NORMAL}"
  	echo -e $message
}

# Must be installed bun
bun -v
# Must be installed rust
cargo -V
rustc -V
gcc --version || error "Some common Rust packages depend on C code and will need a C compiler, try installing gcc"

cat .env.example > .env.development
echo ".env.development file has been created"

cat .env.example > .env.production
echo ".env.production file has been created"

bun install
bun run reinit:db
bun run reinit:testdb

cargo build --release

echo
echo "Done!"