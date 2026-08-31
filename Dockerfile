# Estágio 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Estágio 2: Produção
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/src ./src
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000
CMD ["npm", "start"]