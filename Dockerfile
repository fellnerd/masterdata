# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# =====================================================
# Install dbt for MDS data processing
# =====================================================
RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    unixodbc \
    unixodbc-dev \
    freetds-dev \
    build-base \
    python3-dev

# Install dbt-core and dbt-sqlserver
RUN pip3 install --break-system-packages \
    dbt-core==1.9.0 \
    dbt-sqlserver==1.9.0

# Add non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy dbt project
COPY --chown=nextjs:nodejs ./dbt ./dbt

# Environment variables
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# dbt environment variables (override at runtime)
ENV DBT_PROFILES_DIR=/app/dbt
ENV MDS_DB_SERVER=""
ENV MDS_DB_DATABASE=""
ENV MDS_DB_USER=""
ENV MDS_DB_PASSWORD=""

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Bootstrap dbt schemas at startup, then run Next.js
CMD ["sh", "-c", "cd /app/dbt && dbt run-operation bootstrap_mds --target prod 2>/dev/null || true && cd /app && node server.js"]
