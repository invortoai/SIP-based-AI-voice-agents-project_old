FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY ../../package.json ../../package-lock.json* ./
RUN npm ci --omit=dev || npm ci --omit=dev --workspaces=false

FROM base AS build
COPY --from=deps /app /app
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN npm pkg set scripts.start="node dist/index.js"
EXPOSE 8080
CMD ["npm", "start"]

