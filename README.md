# WebFC
**用 Xiaomi MiMo，在浏览器里做一台红白机。**

“这是我使用 Xiaomi MiMo 辅助编程完成的个人练手 demo：用 JavaScript 实现 FC/NES 模拟器，配上复古 CRT 显示效果。重点不是追求完整的游戏兼容性，而是记录一次用 AI 辅助实现、调试和验证复杂小项目的实践。”

> **注意**：这是个人学习项目，非 Xiaomi MiMo 官方项目，与小米公司无关。

---

## 功能

- **CPU**：6502 (Ricoh 2A03) 核，官方 151 条指令 + 常见非官方指令，周期计数精确
- **PPU**：2C02 逐像素渲染管线，支持逐点滚动、sprite 0 hit、8x8/8x16 精灵
- **APU**：2A03 APU，方波 ×2 + 三角波 + 噪声 + 帧计数器（DMC 未实现，见限制说明）
- **Mapper**：0 (NROM) / 1 (MMC1) / 2 (UxROM) / 3 (CNROM) / 7 (AxROM，有缺陷) / 66 (GxROM)
- **CRT 效果**：WebGL 后处理，扫描线/孔栅/辉光/噪点/桶形畸变，各独立可调
- **输入**：键盘 + 标准 Gamepad API 手柄 + 移动端触屏虚拟手柄（自动显示）
- **即时存档**：localStorage 按 ROM 名哈希分槽，支持自动存档
- **无构建依赖**：纯 HTML + CSS + JS，无 npm，HTTP 服务器即可运行
- **本地加载 ROM**：浏览器拖拽或文件选择，ROM 不离开本地，不上传服务器

---

## 快速开始

```bash
git clone https://github.com/quengh/webfc.git
cd webfc
python3 -m http.server 8848 --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:8848`，然后自行选择你有权使用的本地 `.nes` 文件。

> **ROM 说明**：本源码包不含任何 ROM 文件。页面可能显示“内置免费 ROM”按钮，但对应资源未随代码附带，选择**本地 ROM 文件**入口即可正常使用。

---

## 按键

| FC 按键 | 键盘 |
|---------|------|
| 方向键 | 方向键 |
| A | X |
| B | Z |
| Start | Enter |
| Select | 右 Shift |

支持标准 Gamepad API 手柄（按任意键激活），移动端自动显示触屏虚拟手柄。

---

## 已知限制

- **Mapper 7 / AxROM**：bank 读取、bank 写入位选择、单屏镜像控制均存在缺陷，目前不可靠
- **PPU 精细时序**：逐指令驱动粒度，dot 级 NMI 时序和部分 sprite 0 hit 边角案例未完整实现
- **Sprite overflow**：近似实现，不模拟硬件评估怪癖
- **DMC 未实现**：APU 第五通道（PCM 采样）缺失，部分游戏采样音效可能缺失（不是所有游戏全无声）
- **兼容性未系统验证**：Mapper 0/1/2/3/66 均有实现，但不保证所有 ROM 正确运行
- 商业游戏兼容性因 ROM 而异，本项目未针对完整兼容性做优化

---

## 目录结构

```
webfc/
├── index.html          主页（ROM 加载 UI、CRT 控制面板）
├── css/style.css       样式
├── js/
│   ├── cpu.js          6502 CPU 核
│   ├── ppu.js          2C02 PPU
│   ├── apu.js          2A03 APU
│   ├── cart.js         iNES 解析 + Mapper
│   ├── nes.js          总线 / 手柄 / 帧调度 / 存档
│   ├── crt.js          WebGL CRT 后处理
│   └── ui.js           页面 UI / 音频输出 / 输入绑定
├── docs/REVIEW.md      代码审查摘要（架构、已知问题）
└── tests/              测试脚本（历史开发辅助脚本）
    ├── cpu_selftest.js  独立 CPU 操作码自测（无外部依赖）
    └── ...（其余脚本需自备 ROM 及调整环境，见 tests/README.md）
```

---

## 运行测试

**语法检查**（无需 ROM）：

```bash
for f in js/*.js; do node --check "$f"; done
```

**CPU 操作码自测**（无需 ROM）：

```bash
node tests/cpu_selftest.js
```

输出 `CPU OPCODE SELF-TEST: ALL OK` 表示通过。

其他历史测试脚本（`tests/r2-*`、`tests/r3-*`、`tests/r4-*`、`tests/playtest.js` 等）需要自备合规测试 ROM 并调整 `/tmp/nes-emu/` 等路径，仅供开发参考，非开箱即用测试。

---

## 许可证

本项目目前未指定开源许可证，版权由作者保留。

ROM 版权归各自原始版权方所有，与本项目代码无关。
