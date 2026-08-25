# syntax=docker/dockerfile:1
# Pinagem de versão evita alterações inesperadas na imagem base.
FROM node:22.16.0-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    npm_config_registry=https://registry.npmjs.org/ \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_progress=false

# O package-lock desta entrega usa somente o registro público npmjs.org.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund --progress=false \
  && npm cache clean --force

COPY . .
RUN mkdir -p /app/data /app/public/uploads \
  && chown -R node:node /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--no-warnings", "src/server.js"]
