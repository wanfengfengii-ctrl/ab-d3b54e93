# syntax=docker/dockerfile:1

# ---- 基础阶段：源码与脚本（零依赖，无需 npm install）----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests

# ---- verify：一次性服务，代码测试 + 生产构建 + 导排领域冒烟，完成后退出 ----
FROM base AS verify
CMD ["node", "scripts/verify.mjs"]

# ---- build：产出静态产物 dist/ ----
FROM base AS build
RUN node scripts/build.mjs

# ---- web：nginx 静态服务，含健康检查 ----
FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
