# Squirrel Lab live server: runs the experiment 24/7 and serves the spectator site.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build:live

# Hugging Face Spaces expects port 7860 and runs as a non-root user; keep the save in a writable place
ENV NODE_ENV=production \
    PORT=7860 \
    LAB_SPEED=1 \
    LAB_SAVE=/tmp/squirrel-lab/save.json
RUN mkdir -p /tmp/squirrel-lab && chmod -R 777 /tmp/squirrel-lab

EXPOSE 7860
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "scripts/lab-server.ts"]
