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

# Build the application
RUN npm run -w packages/shared build
RUN npm run -w packages/shared-core build
RUN npm run -w services/telephony build

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
EXPOSE 8085
CMD ["node", "dist/index.js"]

