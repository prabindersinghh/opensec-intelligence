# Demo vulnerable app — intentionally insecure Dockerfile.
FROM node:latest

WORKDIR /app
COPY . .
RUN npm install

# Runs as root — no least-privilege user.
USER root

ENV API_KEY=ak_live_demohardcodedkey1234567890

CMD ["node", "src/server.js"]
