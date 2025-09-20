# Monorepo-aware Dockerfile using root context and npm workspaces
# Build context must be repo root (configure in CI/compose)
FROM node:20-alpine AS deps
WORKDIR /workspace

# Copy root manifests and workspace package.json to allow a single npm ci
COPY package.json package-lock.json ./
COPY packages/*/package.json packages/*/
COPY services/*/package.json services/*/
COPY sdk/*/package.json sdk/*/
RUN npm ci || npm install

# Build only this workspace to generate dist
FROM deps AS build
COPY . .
# Build shared packages first
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build
# Then build the service
RUN npm run -w services/realtime build
# Prune dev deps for lean runtime
RUN npm prune --omit=dev

# Runtime image
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Bring production node_modules from build stage (includes shared workspaces)
COPY --from=build /workspace/node_modules ./node_modules
# Copy built service files
COPY --from=build /workspace/services/realtime/dist ./dist
# Copy service manifest
COPY --from=build /workspace/services/realtime/package.json ./package.json
EXPOSE 8081
CMD ["node", "dist/index.js"]

