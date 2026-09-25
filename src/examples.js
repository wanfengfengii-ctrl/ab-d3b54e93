/**
 * 内置示例屋面（浏览器界面与 Node 冒烟共用）。
 * 坐标均为 0 基 (r, c)。
 */
import { createGrid, indexOf, setFragile } from './flow.js';

/**
 * 安全示例：6×8 双排水口屋面。
 * 高程 ≈ 到最近排水口的曼哈顿距离，屋脊处的水可进入任一排水口（汇水区重叠）；
 * (3,3)、(4,3) 处做了局部整平，形成一道"未被水流跨越"的脆弱接缝 (3,3)-(3,2)，
 * 用于演示接缝存在但不影响安全。
 */
export function exampleSafe() {
  const rows = 6;
  const cols = 8;
  const g = createGrid(rows, cols);
  const d1 = [5, 0];
  const d2 = [0, 7];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.elev[indexOf(g, r, c)] = Math.min(
        Math.abs(r - d1[0]) + Math.abs(c - d1[1]),
        Math.abs(r - d2[0]) + Math.abs(c - d2[1]),
      );
    }
  }
  // 局部整平，使接缝 (3,3)-(3,2) 两侧各自向更低处排水、互不跨越
  g.elev[indexOf(g, 3, 3)] = 4;
  g.elev[indexOf(g, 4, 3)] = 3;
  g.drains[indexOf(g, d1[0], d1[1])] = true;
  g.drains[indexOf(g, d2[0], d2[1])] = true;
  setFragile(g, indexOf(g, 3, 3), indexOf(g, 3, 2), true);
  return g;
}

/**
 * 病害示例：在安全示例基础上
 *  1) 接缝 (3,4)-(3,3) 变为脆弱接缝，而 (3,4) 的允许流向恰会跨越它 → 进入脆弱接缝；
 *  2) 边界格 (4,7) 被压成洼地（高程 -5），四周更高 → 边界外流。
 * 行优先首个问题起点为 (3,4)；修复该接缝后重新审计才会暴露 (3,5) 起的边界外流链。
 */
export function exampleFault() {
  const g = exampleSafe();
  setFragile(g, indexOf(g, 3, 4), indexOf(g, 3, 3), true);
  g.elev[indexOf(g, 4, 7)] = -5;
  return g;
}
