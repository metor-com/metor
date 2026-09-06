# metor push relay (ADR-0017) – build context: backend/relay
FROM node:22-alpine
WORKDIR /app
COPY relay.mjs package.json ./
USER node
EXPOSE 6020
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:6020/health >/dev/null || exit 1
CMD ["node", "relay.mjs"]
