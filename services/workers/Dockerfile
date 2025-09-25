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

# Build the application
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build
# Install service dependencies
RUN cd services/workers && npm install
RUN npm run -w services/workers build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built application
COPY --from=0 /workspace/dist ./dist
COPY --from=0 /workspace/package.json ./

# Install production dependencies only
RUN npm ci --only=production

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/index.js"]

