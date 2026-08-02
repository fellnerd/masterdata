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
    openssh-client \
    curl \
    gnupg \
    unixodbc \
    unixodbc-dev \
    freetds-dev \
    build-base \
    python3-dev

# Install Microsoft ODBC Driver 18 (profiles.yml targets reference it by name;
# unixodbc alone is only the driver manager, not this driver). Architecture is
# detected at build time since Microsoft ships separate amd64/arm64 .apk files
# (the same x86-64 binary silently fails to dlopen on an arm64 host).
RUN case "$(uname -m)" in \
      x86_64) MSODBC_ARCH=amd64 ;; \
      aarch64) MSODBC_ARCH=arm64 ;; \
      *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;; \
    esac && \
    curl -O https://download.microsoft.com/download/0b3d5518-b4a7-4a2b-afc7-7ee9e967f93c/msodbcsql18_18.6.2.1-1_${MSODBC_ARCH}.apk && \
    apk add --allow-untrusted msodbcsql18_18.6.2.1-1_${MSODBC_ARCH}.apk && \
    rm -f msodbcsql18_18.6.2.1-1_${MSODBC_ARCH}.apk

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
