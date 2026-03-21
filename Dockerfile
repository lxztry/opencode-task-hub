FROM node:20-alpine

LABEL maintainer="lztry"
LABEL description="OpenCode Task Hub - Real-time task management for AI coding assistants"

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY server.js ./
COPY public ./public
COPY plugins ./plugins

ENV PORT=3030
ENV DATA_FILE=/app/data.json

EXPOSE 3030

VOLUME ["/app/data.json"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/sessions || exit 1

USER node

CMD ["node", "server.js"]
