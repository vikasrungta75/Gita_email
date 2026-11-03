# Gita Mail, local edition: web app, API and background worker in one container
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build
ENV PORT=8888 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 8888
CMD ["npx", "tsx", "scripts/local-server.ts"]
