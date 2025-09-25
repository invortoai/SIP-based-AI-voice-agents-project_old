FROM node:20-alpine

WORKDIR /workspace

# Copy package files
COPY package*.json ./
COPY packages/*/package.json packages/*/
COPY services/*/package.json services/*/
COPY sdk/*/package.json sdk/*/

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Clean up any existing dist directories to prevent cache conflicts
RUN rm -rf /workspace/dist


# Install dependencies for shared packages specifically
RUN npm install --workspace=packages/shared
RUN npm install --workspace=packages/shared-core

# Build shared packages first
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build

# Build only this service
RUN npm run -w services/telephony build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy production node_modules from build stage (includes workspace deps like @invorto/shared)
COPY --from=0 /workspace/node_modules ./node_modules
# Copy built shared packages to node_modules
COPY --from=0 /workspace/packages/shared ./node_modules/@invorto/shared
COPY --from=0 /workspace/packages/shared-core ./node_modules/@invorto/shared-core
# Copy built service
COPY --from=0 /workspace/services/telephony/dist ./dist
# Copy service package.json (start script already defined)
COPY --from=0 /workspace/services/telephony/package.json ./package.json

# Set environment variables
ENV NODE_ENV=production

# Start the application
EXPOSE 8085
CMD ["node", "dist/index.js"]
