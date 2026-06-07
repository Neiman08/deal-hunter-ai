# Deal Hunter AI — Multi-stage Docker build
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# Stage 2: Production backend
FROM node:20-alpine AS production
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy backend
COPY backend/package*.json ./
RUN npm ci --only=production --silent && npm cache clean --force

COPY backend/src/ ./src/

# Copy built frontend to serve statically (optional)
COPY --from=frontend-build /app/frontend/dist ./public

# Set ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3001

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
