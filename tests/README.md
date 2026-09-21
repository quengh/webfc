# 测试目录说明

## 无需外部 ROM 的 CPU 自测

在仓库根目录执行：

```bash
node tests/cpu_selftest.js
```

预期输出：`CPU OPCODE SELF-TEST: ALL OK`。

脚本将参考表定义的操作码与指令长度、基准周期数进行对照，并对算术、标志位等行为做抽查。未定义参考项会被跳过，因此通过不等于全部 256 种操作码及全部硬件行为均已验证。

JavaScript 语法检查：

```bash
for f in js/*.js tests/*.js; do node --check "$f"; done
```

不需要安装 npm 包。

## 历史开发辅助脚本

其他脚本保留了项目迭代过程中的调试思路，并非全部可开箱即用。

- `run_node_tests.js`：使用外部测试 ROM 的批量测试。
- `playtest.js`、`r2-*.js`、`r3-*.js`、`r4-*.js`：不同阶段的运行、渲染与精灵调试。
- `harness.html`、`run_chrome_tests.sh`：浏览器测试入口与辅助脚本。
- `pngcheck.py`、`ref_engine.py`：图像或渲染数据检查辅助。
- 其余脚本用于指令跟踪、反汇编、CHR/OAM/内存等数据检查。

使用前请先阅读脚本：

1. 部分脚本硬编码 `/tmp/nes-emu/` 等原开发目录，需要调整为本地路径。
2. 需要自行准备有权使用、许可明确的测试 ROM，以及对应浏览器或 Python 环境。
3. 历史日志、JSON 调试数据和像素转储未随仓库发布；依赖这些输入的脚本需要先重新生成数据。
4. 本次没有重新运行完整 ROM 测试或浏览器画面、音频测试。

仓库不提供游戏 ROM。不要把商业 ROM、凭据或个人数据提交到仓库。
