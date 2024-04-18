#!/usr/bin/env bash

set -e

bun -v

cat <<EOF >.env.development
# The time zone format used by the server. Make sure to use UTC.
TZ="UTC"

# Display log messages while the task is running.
# Set the value to 1 to enable debugging during development.
# 0 means FALSE and 1 means TRUE.
LOG=1

# Set the port value to run the server
# Default: 3200
PORT=

# Database
# Path to the SQLite Database file
PATH_SQLITE="./db/test/tasks.db"
# Backup method SQLite
# Local backup is a backup method that moves database files to another directory
BACKUP_METHOD_SQLITE="LOCAL"
# Backup directory SQLite, example:
# "/tmp/tasks/bakdb/test" ✅
# "/tmp/tasks/bakdb/test/" ❌
# "/tmp/tasks/bakdb/test/tasks.db" ❌
BACKUP_DIR_SQLITE="/tmp/tasks/bakdb/test"
# Pattern cron job
# This can be generated by tools like https://crontab.guru
# Default: Every day at midnight
BACKUP_CRON_PATTERN_SQLITE=
# Timezone cron job
# Default: reference to env TZ
BACKUP_CRON_TZ_SQLITE=
#
# The backup method uses Google Cloud Storage
#
# Google Cloud project ID
# Visit: https://support.google.com/googleapi/answer/7014113
BACKUP_GCS_PROJECT_ID_SQLITE=
#
# Before getting the private key, client id, and client email create a service account first
#
# Visit: https://cloud.google.com/iam/docs/service-accounts-create
# Private key
BACKUP_GCS_PRIVATE_KEY_SQLITE=
# Client ID
BACKUP_GCS_CLIENT_ID_SQLITE=
# Client Email
BACKUP_GCS_CLIENT_EMAIL_SQLITE=
# Bucket name
# Visit: https://cloud.google.com/storage/docs/buckets#naming
BACKUP_BUCKET_NAME_SQLITE=
# Bucket directory
BACKUP_BUCKET_DIR_SQLITE=

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

cat <<EOF >.env.production
# The time zone format used by the server. Make sure to use UTC.
TZ="UTC"

# Set the port value to run the server
# Default: 3200
PORT=

# Database
# Path to the SQLite Database file
PATH_SQLITE="./db/tasks.db"
# Backup method SQLite
# Local backup is a backup method that moves database files to another directory
BACKUP_METHOD_SQLITE="LOCAL"
# Backup directory SQLite, example:
# "/tmp/tasks/bakdb/test" ✅
# "/tmp/tasks/bakdb/test/" ❌
# "/tmp/tasks/bakdb/test/tasks.db" ❌
BACKUP_DIR_SQLITE="/tmp/tasks/bakdb"
# Pattern cron job
# This can be generated by tools like https://crontab.guru
# Default: Every day at midnight
BACKUP_CRON_PATTERN_SQLITE=
# Timezone cron job
# Default: reference to env TZ
BACKUP_CRON_TZ_SQLITE=
#
# The backup method uses Google Cloud Storage
#
# Google Cloud project ID
# Visit: https://support.google.com/googleapi/answer/7014113
BACKUP_GCS_PROJECT_ID_SQLITE=
#
# Before getting the private key, client id, and client email create a service account first
#
# Visit: https://cloud.google.com/iam/docs/service-accounts-create
# Private key
BACKUP_GCS_PRIVATE_KEY_SQLITE=
# Client ID
BACKUP_GCS_CLIENT_ID_SQLITE=
# Client Email
BACKUP_GCS_CLIENT_EMAIL_SQLITE=
# Bucket name
# Visit: https://cloud.google.com/storage/docs/buckets#naming
BACKUP_BUCKET_NAME_SQLITE=
# Bucket directory
BACKUP_BUCKET_DIR_SQLITE=

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

echo ".env.development file has been created"
echo ".env.production file has been created"

bun install