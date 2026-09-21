# WebFC 代码审查摘要

审查日期：2026-09-21  
审查范围：静态分析 + 无 ROM 本地实测（cpu_selftest.js / 自制微型 ROM 冠烟测试）

---

## 架构概述

**优点**
- 零依赖：纠 HTML5 实现，无构建工具，无第三方库
- CommonJS 与浏览器双环境兼容，便于 Node 测试
- 各模块职责明确：cpu / ppu / apu / cart / nes / crt / ui​独立成文件
- CPU 精度高：官方指令 + 主流非官方指令全实现，page-cross/分支/JSR/RTI/NMI/IRQ 周期正确，dummy read 行为与硬件一致

**局限**
- PPU 为逐指令驱动，无法实现 dot 级精细时序
- `tests/` 包含大量开发过程脚本，历史日志已排除未上传

---

## 已知问题（静态分析确认）

### 🔴 问题 1：AxROM (Mapper 7) bank 写入位选择错误
**位置**：`js/cart.js` 第 169 行

```js
// 当前（错误）：使用 bit4-6 选 bank
this.prgBank = (val >> 4) & 7;

// 硬件规范：应使用 bit0-2
this.prgBank = val & 7;
```

影响：除非 val >= 0x10，否则 bank 切换无效。

### 🔴 问题 2：AxROM readPRG 忽略 prgBank 寄存器
**位置**：`js/cart.js` 第 123 行

```js
// 当前（错误）：备忘 this.prgBank，始终从偏移 0 读取
case 7:
  return this._prgReadBase((addr - 0x8000) & 0x7FFF);

// 正确应为：
case 7:
  return this._prgReadBase((this.prgBank & 7) * 0x8000 + ((addr - 0x8000) & 0x7FFF));
```

影响：128KB AxROM 游戏只能运行 bank 0，bank 切换完全失效。这两个问题通过自制微型 ROM 冠烟测试已公开复现（写入 val=2 切到 bank 2，读取应得 0x42 实际得 0x00）。

### 🟡 问题 3：AxROM 镜像控制是死代码
**位置**：`js/cart.js` 第 170-171 行

```js
this.mirroring = (val & 0x10) ? 2 : 2; // 两分支均赋 2
this.mirroring = 0;                      // 立即覆盖：始终水平镜像
```

影响：AxROM 应用 bit4 控制单屏镜像，当前始终水平镜像近似，可能导致背景滚动错误。

---

## PPU / APU 已知局限（架构决定的已承设限制）

| 项 | 说明 |
|-----|------|
| PPU dot 级 NMI 时序 | 逐指令驱动，无法实现 ±1 dot 精度；ppu_vbl_nmi 02/04–08/10 共 7 项 blargg 失败 |
| Sprite overflow | 扈描线总数 > 8 简单近似，不模拟硬件评估怪癖；sprite_overflow 1/3/4/5 失败 |
| DMC | APU 第五通道未实现，部分游戏 PCM 采样音效可能缺失 |

---

## 本次实际测试结果

**语法检查**：js/ 目录全部 7 个 JS 文件 `node --check`，全部通过。

**CPU 自测**：`node tests/cpu_selftest.js` 输出
```
CPU OPCODE SELF-TEST: ALL OK
```
参考表覆盖的操作码和行为抄查均通过（论证表跳过 LEN 未定义项，不声称全部 256 已覆盖）。

**自制微型 ROM 冠烟 + 缺陷复现**：11 项，包含“预期缺陷存在”断言（即 AxROM bank 切换 bug 已公开可复现），全部通过。

---

## 安全扫描结论

| 检查项 | 结果 |
|----------|------|
| 商业 ROM 文件 | ✅ 无 |
| 密钥 / Token 模式 | ✅ 无 |
| 内部域名 / 私人路径 | ✅ 无（/tmp/nes-emu/ 为开发过程编译期路径） |
| ZIP 路径穿越 | ✅ 无 |
| 符号链接 | ✅ 无 |
