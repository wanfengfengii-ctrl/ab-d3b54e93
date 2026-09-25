# syntax=docker/dockerfile:1

# ---------- 构建阶段：安装依赖、测试与生产构建 ----------
FROM node:22-alpine AS build
WORKDIR /app

# 先复制依赖清单以利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --cache /tmp/.npm-cache

COPY . .
# 单元测试由一次性 verify 服务运行；此处仅产出静态产物供 runtime 阶段复制
RUN npm run build

# ---------- 运行阶段：仅含静态产物的 nginx ----------
FROM nginx:1.27-alpine AS runtime

# 容器内 nginx 健康检查所需（wget 已内置于 alpine；curl 亦备）
RUN apk add --no-cache curl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
