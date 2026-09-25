#!/bin/sh
# 一次性 verify 服务入口：等待静态服务健康检查通过，
# 依次执行 代码测试 → 生产构建 → 导排领域冒烟（含站点 HTTP 冒烟），
# 全部成功则退出码 0，任一失败以非零码退出。
set -e

BASE="${SMOKE_BASE_URL:-http://web}"

echo "[verify] 等待静态服务 ${BASE} 健康检查通过……"
i=0
until node -e "fetch(process.argv[1]+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$BASE"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[verify] 等待 ${BASE}/health 超时" >&2
    exit 1
  fi
  sleep 2
done
echo "[verify] 静态服务已就绪。"

echo "[verify] 1/3 代码测试（vitest）"
npm test

echo "[verify] 2/3 生产构建（vite build）"
npm run build

echo "[verify] 3/3 导排领域冒烟（含站点 HTTP 冒烟）"
SMOKE_BASE_URL="$BASE" node scripts/smoke.mjs

echo "[verify] 全部通过，verify 退出码 0。"
