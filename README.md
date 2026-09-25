# 古建筑屋面导排审计（Roof Drainage Audit）

现场工程师在屋面网格图上逐格标注**整数高程**、**排水口**与**不可过水的脆弱接缝**，
在浏览器本地发起审计，确认临时防雨层不会把雨水引入病害区域。无后端，所有计算在浏览器内完成。

## 水流与审计规则（按共享边，四邻域）

- 水每一步可流向**相邻且高程不高于当前格的最低格**；
  多个邻格并列最低时，**每一个并列方向都是允许流向**。
- 审计必须覆盖每个普通格的**全部**允许流向——不能因存在一条通往排水口的路线就判定安全。
- 以下任一情形即失效：
  - **边界外流**：格在边界且格内再无“不高于”去向，水流出网格；
  - **无去路**：内部格四周均高于自身；
  - **进入脆弱接缝**：水进入不可过水的接缝格；
  - **等高区域循环**：允许流向构成可到达的环，水可无限循环。
- 判定算法把“所有允许流路终于排水口”建模为格点图性质，
  采用三色 DFS（未访问/访问中/已完成）+ 记忆化，整体 O(V+E)，大平板不会指数爆炸。
- 不安全时按**行优先**（从上到下、从左到右）返回首个问题起点，
  并在网格上按序号标出一条每一步均为合法允许流向的**可复核失效链**。
- 安全时显示：每格可达排水口结论表、各排水口的汇水格集合（点击可在网格高亮）。
- **任何草稿修改（高程/类型/重建网格）都会立即作废旧结论并提示重新审计。**

## 本地开发

```bash
npm install          # 安装依赖
npm test             # 单元测试（Vitest，17 项）
npm run dev          # 开发服务器
npm run build        # 生产构建到 dist/
npm run smoke        # 导排领域冒烟（24 项断言；设置 SMOKE_BASE_URL 追加站点 HTTP 冒烟）
```

## Docker 交付

提供 `Dockerfile`（多阶段：Node 构建 → nginx 静态托管）与 `docker-compose.yml`。

- `web`：长期运行的静态 Web 服务（nginx），内置 `/health` 健康检查
  （Dockerfile `HEALTHCHECK` 与 compose `healthcheck` 均已配置）。
  宿主机端口由 **`WEB_PORT`** 配置（默认 `8080`，容器内固定 80）。
- `verify`：**一次性服务**，`depends_on: web: service_healthy`，
  等待 web 健康后依次执行「代码测试 → 生产构建 → 导排领域冒烟（含对 web 的 HTTP 冒烟）」，
  随后自行退出，并以**退出码**报告结果（0 通过 / 非 0 失败）。

```bash
# 启动静态服务（自定义宿主端口）
WEB_PORT=8080 docker compose up -d web
curl http://localhost:8080/health        # => ok

# 运行一次性校验：观察退出码
docker compose up --build verify
# docker compose ps 中 verify 显示 Exited (0) 即全部通过
```

健康检查端点：`GET /health` 返回 `200 ok`。

## 目录结构

```
index.html                  页面骨架
src/main.js                 网格编辑、审计发起、结论/失效链渲染、旧结论作废
src/styles.css
src/domain/drainage.js      纯函数领域核心（无 DOM 依赖）
src/domain/drainage.test.js 单元测试
scripts/smoke.mjs           导排领域冒烟 + 站点 HTTP 冒烟
scripts/verify-entrypoint.sh 一次性 verify 服务入口
nginx.conf                  静态托管 + /health
Dockerfile                  build / runtime 多阶段
docker-compose.yml          web（常驻）+ verify（一次性）
```
