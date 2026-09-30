FROM node:20-alpine

WORKDIR /app

# 零第三方依赖：仅拷贝源码与静态资源
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY test ./test

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

# 容器内自检由 compose healthcheck 使用 busybox wget 访问 /healthz
CMD ["node", "server.js"]
