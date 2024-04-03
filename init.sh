#!/usr/bin/env bash

set -e

bun -v

cat <<EOF >.env
# The time zone format used by the server. Make sure to use UTC.
TZ="UTC"

# Display log messages while the task is running.
# Set the value to 1 to enable debugging during development.
# 0 means FALSE and 1 means TRUE.
LOG=1

# Set the port value to run the server
# Default: 3200
PORT=

# Configure level for functions that run only during development.
# Remove value or comment during production.
LEVEL="DEV"

# Path to the SQLite Database file
PATH_SQLITE="./db/tasks.db"
PATH_TEST_SQLITE="./db/test/tasks.db"

# The cipher key to encrypt sensitive data before it enters the database.
# Make sure to use a random character value.
# Default: EMPTY
CIPHER_KEY=

# The hostname is used to check the internet connectivity. The server requires an internet connection before it can run.
# This connectivity is to ensure that the server is connected to the internet.
# Default: google.com
CONNECTIVITY_HOSTNAME=

# Maximum size of the body request in bytes
# Default: 32kb
MAX_SIZE_BODY_REQUEST=32768

# Configure TLS/SSL to run the server with HTTPS protocol.
# Use the tls directory to store TLS/SSL certificates
# Default: EMPTY
PATH_TLS_CA=
PATH_TLS_KEY=
PATH_TLS_CERT=
EOF

echo ".env file created"

bun install
bun init-db.ts test
bun test --timeout 10000

echo "On-Premise Tasks is ready to serve"