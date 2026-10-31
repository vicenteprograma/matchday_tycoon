# Football Matchday server. Build: docker build -t football-matchday .
FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer is cached until package files change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY server ./server
COPY web ./web

# Saved matches live in /data. Mount a volume or a TrueNAS dataset there to keep them across restarts.
RUN mkdir -p /data && chown node:node /data
ENV PORT=3000 \
    DATA_DIR=/data \
    NODE_ENV=production
VOLUME /data
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
