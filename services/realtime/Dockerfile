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
RUN cd packages/shared && npm install
RUN cd packages/shared-core && npm install

# Install dependencies for each service
RUN cd services/api && npm install
RUN cd services/realtime && npm install
RUN cd services/webhooks && npm install
RUN cd services/workers && npm install
RUN cd services/telephony && npm install

# Build shared packages first
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build

# Install dependencies for this service
RUN cd services/realtime && npm install

# Build only this service
RUN npm run -w services/realtime build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy production node_modules from build stage (includes workspace deps like @invorto/shared)
COPY --from=0 /workspace/node_modules ./node_modules
# Copy built shared packages to node_modules
COPY --from=0 /workspace/packages/shared ./node_modules/@invorto/shared
COPY --from=0 /workspace/packages/shared-core ./node_modules/@invorto/shared-core
# Copy built service
COPY --from=0 /workspace/services/realtime/dist ./dist
# Copy service package.json (start script already defined)
COPY --from=0 /workspace/services/realtime/package.json ./package.json

# Set environment variables
ENV NODE_ENV=production

# Start the application
EXPOSE 8081
CMD ["node", "dist/index.js"]

