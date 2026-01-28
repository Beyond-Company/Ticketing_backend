#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Wait for PostgreSQL to be ready
until nc -z postgres 5432; do
  echo "Database is unavailable - sleeping"
  sleep 1
done

echo "Database is ready!"
echo "Running database migrations..."
npx prisma migrate deploy || echo "Migrations may have already been applied"

echo "Starting application..."
exec "$@"

