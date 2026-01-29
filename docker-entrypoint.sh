#!/bin/sh
set -e

# Check if DATABASE_URL is set (Railway provides this)
if [ -n "$DATABASE_URL" ]; then
  echo "DATABASE_URL is set, skipping hostname-based connection check"
  # Extract host and port from DATABASE_URL for health check
  DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
  DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
  
  if [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
    echo "Waiting for database to be ready at $DB_HOST:$DB_PORT..."
    until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
      echo "Database is unavailable - sleeping"
      sleep 1
    done
    echo "Database is ready!"
  fi
else
  # Fallback for Docker Compose (local development)
  echo "Waiting for database to be ready..."
  until nc -z postgres 5432; do
    echo "Database is unavailable - sleeping"
    sleep 1
  done
  echo "Database is ready!"
fi

echo "Running database migrations..."
npx prisma migrate deploy || echo "Migrations may have already been applied"

echo "Starting application..."
exec "$@"

