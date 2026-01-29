# Use Node.js LTS version (Debian-based for better Prisma compatibility)
FROM node:20-slim

# Install dependencies for Prisma and health checks
RUN apt-get update && apt-get install -y \
    openssl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (needed for Prisma migrations)
RUN npm ci

# Copy Prisma schema
COPY prisma ./prisma

# Generate Prisma Client
RUN npx prisma generate

# Copy source code
COPY . .

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Build TypeScript
RUN npm run build

# Note: Keeping all dependencies including Prisma for migrations
# In production, consider moving Prisma to dependencies in package.json

# Expose port
EXPOSE 5000

# Health check (uses PORT env var, defaults to 5000)
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5000) + '/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use entrypoint script
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["npm", "start"]

