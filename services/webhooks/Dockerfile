# Monorepo-aware Dockerfile using root context and workspace installs
# Build context must be the repo root (set in compose or CI)
FROM node:20-alpine AS deps
WORKDIR /workspace

# Force cache invalidation by using build timestamp
ARG BUILD_TIMESTAMP
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}

# Copy root package.json first to establish workspace structure
COPY package.json package-lock.json ./

# Copy all workspace package.json files to enable proper dependency resolution
COPY packages/shared/package.json packages/shared/
COPY packages/shared-core/package.json packages/shared-core/
COPY services/api/package.json services/api/
COPY services/realtime/package.json services/realtime/
COPY services/telephony/package.json services/telephony/
COPY services/webhooks/package.json services/webhooks/
COPY services/workers/package.json services/workers/
COPY sdk/browser/package.json sdk/browser/
COPY sdk/node/package.json sdk/node/
COPY sdk/python/pyproject.toml sdk/python/

# Copy source files for workspaces that need them for proper dependency resolution
COPY packages/shared/src packages/shared/src
COPY packages/shared-core/src packages/shared-core/src

# Install all workspace dependencies
RUN npm ci || npm install

# Build only this workspace
FROM deps AS build
COPY . .
# Install dependencies for shared package first
RUN cd packages/shared && npm install
# Build shared packages first
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build
# Then build the service
RUN npm run -w services/webhooks build

# Runtime image
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copy production node_modules from build (includes workspace deps like @invorto/shared)
COPY --from=build /workspace/node_modules ./node_modules
# Copy built shared packages to node_modules
COPY --from=build /workspace/packages/shared ./node_modules/@invorto/shared
COPY --from=build /workspace/packages/shared-core ./node_modules/@invorto/shared-core
# Copy built service
COPY --from=build /workspace/services/webhooks/dist ./dist
# Copy service package.json (start script already defined)
COPY --from=build /workspace/services/webhooks/package.json ./package.json
EXPOSE 8082
CMD ["node", "dist/index.js"]
