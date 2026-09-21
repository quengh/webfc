# tests/ 目录说明

## 可开笱即用（无需 ROM）

### `cpu_selftest.js`
独立 CPU 操作码自测脚本。对全部操作码验证指令长度、基准周期数对照独立基准表，并对算术/逻辑操作做行为抄查。无外部依赖。

```bash
cd /path/to/webfc
node tests/cpu_selftest.js
# 期望输出：CPU OPCODE SELF-TEST: ALL OK
```

---

## 需备环境的开发至脚本

以下脚本是开发过程中各轮验证使用的辅助工具。它们通常需要：

1. 自备合规测试 ROM（blargg 安装包、240p Test Suite 等开源 homebrew）
2. 将 ROM 放在 `/tmp/nes-emu/roms/` 目录（或修改脚本内路径）
3. 在 `/tmp/nes-emu/` 目录有排列 js/ 文件（或修改 require 路径指向本仓库）

**脚本列表**

| 脚本 | 用途 |
|--------|------|
| `run_node_tests.js` | blargg 测试 ROM 批量跡上 |
| `playtest.js` | homebrew ROM 可玩性实测 |
| `r2-*.js` | 第二轮验证：PPU 流水线逐层打拍 |
| `r3-*.js` | 第三轮验证：精灵修复后整体回归测试 |
| `r4-*.js` | 第四轮验证：真实 ROM 实测收口 |
| `harness.html` | Chrome headless 测试入口页 |
| `run_chrome_tests.sh` | Chrome headless 测试跡上脚本 |
| `pngcheck.py` | 林外 PNG 校验（依赖 Pillow） |
| `dis.js` | 反汇编辅助 |
| `dump.js` | 内存/PPU dump |
| `blitlog.js` | 浏览器刷新日志分析 |
| `chrview.js` / `chrwatch.js` | CHR 图样监设 |
| `steptrace.js` / `tracechr.js` | 引擎逐步跟踪 |
| `ref_engine.py` | 图像对比算法（依赖 Pillow） |

这些脚本均为开发展示目的保留，非开笱即用的自动化测试。
