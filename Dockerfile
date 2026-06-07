# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Frontend build output path: /app/frontend/dist
RUN npm run build

# Stage 2: Build the NestJS backend
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
# Backend build output path: /app/backend/dist
RUN npm run build

# Stage 3: Install production-only backend dependencies
FROM node:20-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Stage 4: Runtime environment
FROM node:20-alpine
WORKDIR /app

# Install runtime dependencies: ffmpeg, yt-dlp, and python3 (required by yt-dlp)
RUN apk add --no-cache ffmpeg python3 yt-dlp

# Verification step: Ensure ffmpeg and yt-dlp are functional inside the container
RUN ffmpeg -version && yt-dlp --version

# Create application data storage directory and set ownership to non-root 'node' user
RUN mkdir -p /app/data && chown -R node:node /app/data

# Copy production backend dependencies with proper ownership
COPY --from=backend-deps --chown=node:node /app/backend/node_modules ./node_modules

# Copy compiled NestJS application code with proper ownership
COPY --from=backend-builder --chown=node:node /app/backend/dist ./dist
COPY --from=backend-builder --chown=node:node /app/backend/package.json ./package.json

# Copy compiled frontend assets from Stage 1 (/app/frontend/dist) to the NestJS public directory (/app/public)
COPY --from=frontend-builder --chown=node:node /app/frontend/dist ./public

# Switch execution to the non-root node user (UID 1000) for security hardening
USER node

# Production configuration environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose NestJS server port
EXPOSE 3000

# Health check using Node.js native fetch API
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Boot command
CMD ["node", "dist/main"]
