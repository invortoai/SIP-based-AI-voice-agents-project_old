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


# Build shared packages first
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy root package files for workspace resolution
COPY --from=0 /workspace/package*.json ./

# Create necessary directories
RUN mkdir -p packages/shared services/telephony

# Copy workspace package.json files
COPY --from=0 /workspace/packages/shared/package.json ./packages/shared/
COPY --from=0 /workspace/services/telephony/package.json ./services/telephony/

# Copy built artifacts
COPY --from=0 /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=0 /workspace/services/telephony/dist ./services/telephony/dist

# Install production dependencies only (at root for workspaces)
RUN npm ci --only=production

# Set environment variables
ENV NODE_ENV=production

# Start the application
EXPOSE 8085
CMD ["node", "services/telephony/dist/index.js"]
