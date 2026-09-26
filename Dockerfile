FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# 先装依赖，充分利用镜像层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 应用代码（public/ 内含前端与共享引擎）
COPY server.js ./
COPY public ./public

EXPOSE 3000
CMD ["node", "server.js"]
