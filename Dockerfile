# Pinned to alpine3.21 (Python 3.12) rather than the floating "node:22-alpine"
# tag: newer Alpine releases ship Python 3.14, whose C-API break makes
# pyodbc (a dbt-sqlserver dependency) fail to compile.
# Build stage
FROM node:22-alpine3.21 AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:22-alpine3.21 AS runner

WORKDIR /app

# =====================================================
# Install dbt for MDS data processing
# =====================================================
RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    curl \
    gnupg \
    unixodbc \
    unixodbc-dev \
    freetds-dev \
    build-base \
    python3-dev

# Install Microsoft ODBC Driver 18 (profiles.yml targets reference it by name;
# unixodbc alone is only the driver manager, not this driver)
RUN curl -O https://download.microsoft.com/download/b/9/f/b9f3cce4-3925-46d4-9f46-da08869c6486/msodbcsql18_18.3.3.1-1_amd64.apk && \
    apk add --allow-untrusted msodbcsql18_18.3.3.1-1_amd64.apk || true && \
    rm -f msodbcsql18_18.3.3.1-1_amd64.apk

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

# dbt environment variables - set at runtime via docker-compose/.env, not baked
# into the image (MDS_DB_SERVER/DATABASE/USER/PASSWORD)
ENV DBT_PROFILES_DIR=/app/dbt

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Bootstrap dbt schemas at startup (idempotent), then run Next.js.
# Bootstrap output stays visible in `docker logs` so a real failure (bad
# credentials, unreachable DB) isn't silently swallowed; `|| true` only
# prevents it from stopping the container, since bootstrap_mds is safe to
# re-run and the app can still start even if this step fails.
CMD ["sh", "-c", "cd /app/dbt && dbt run-operation bootstrap_mds --target ${DBT_TARGET:-prod} || true && cd /app && node server.js"]
