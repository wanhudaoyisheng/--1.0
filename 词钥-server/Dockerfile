# 词钥 · 生产镜像
#
# 为什么用 Node 官方镜像而不是构建产物：
# 运行时直接执行 .ts（Node 原生类型擦除）与内置 SQLite，没有编译步骤、
# 没有原生模块，所以镜像里不需要 typescript / 编译工具链。

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DB_FILE=/data/ciyue.db

# 先只拷依赖清单，让这一层能被缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# SQLite 落在 /data：托管平台把持久卷挂到这里即可（不挂也能跑，重启丢对局）
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

# 平台通常自己探 /health，本地也留一个
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-sqlite", "--experimental-strip-types", "src/server.ts"]
