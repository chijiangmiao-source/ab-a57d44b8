FROM node:20-alpine

WORKDIR /app

# 零运行时依赖：直接复制源码即可运行。
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY test ./test

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# 容器内健康检查（Compose 的 verify 服务依赖此健康状态启动）。
HEALTHCHECK --interval=5s --timeout=3s --retries=12 --start-period=2s \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/server.js"]
