# Monorepo-aware Dockerfile using root context and workspace installs
# Build context must be the repo root (set in compose or CI)
FROM node:20-alpine AS deps
WORKDIR /workspace

# Copy root manifests and workspace package manifests to enable npm workspaces install
COPY package.json package-lock.json ./
COPY packages/*/package.json packages/*/
COPY services/*/package.json services/*/
COPY sdk/*/package.json sdk/*/
RUN npm ci || npm install

# Build only this workspace
FROM deps AS build
COPY . .
RUN npm run -w services/api build
# Prune dev deps after build to slim runtime node_modules
RUN npm prune --omit=dev

# Runtime image
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copy production node_modules from build (includes workspace deps like @invorto/shared)
COPY --from=build /workspace/node_modules ./node_modules
# Copy built service
COPY --from=build /workspace/services/api/dist ./dist
# Copy service package.json (start script already defined)
COPY --from=build /workspace/services/api/package.json ./package.json
EXPOSE 8080
CMD ["node", "dist/index.js"]

