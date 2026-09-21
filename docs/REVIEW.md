# WebFC 代码审查摘要

审查日期：2026-09-21。范围：静态代码分析、JavaScript 语法检查、CPU 自测和自制数据缺陷复现。未复测完整游戏兼容性或浏览器图像、声音效果。

## 总体评价

适合作为 AI 辅助编程的个人练手 demo，不应视为成熟、周期精确的 NES 模拟器。

- 核心职责分为 CPU、PPU、APU、卡带映射、总线与调度、CRT 滤镜、UI 七个模块，结构直观。
- 浏览器运行不需要框架或 npm 构建；核心模块兼容 CommonJS，便于在 Node.js 中测试。
- 原有测试覆盖了不同开发阶段，但多数脚本依赖外部 ROM、固定目录或未附带的生成数据，可复现性仍需整理。
- 本次只整理发布材料，运行代码与原始源码保持一致，以下缺陷没有被修复。

## Mapper 7 / AxROM：三个已确认问题

位置均在 `js/cart.js`：

1. **第 169 行，bank 写入取位错误。** `(val >> 4) & 7` 使用高位，而 AxROM 的 PRG bank 选择使用低三位。写入 `2` 后当前 `prgBank` 仍为 `0`。
2. **第 123–124 行，读取忽略 bank 寄存器。** `readPRG()` 的 Mapper 7 分支只使用窗口内地址，始终访问第一个 32KB bank。即使手动设定 `prgBank = 2`，读取结果仍不改变。
3. **第 170–171 行，镜像设置被覆盖。** 条件表达式两边都赋值 `2`，随后又无条件设为 `0`，无法按控制位切换单屏页。

### 无外部 ROM 的最小复现

在仓库根目录执行以下代码。测试数据完全在内存中构造，不含游戏内容。

```bash
node <<'JS'
const Cart = require('./js/cart.js');
const rom = new Uint8Array(16 + 0x20000);
rom.set([0x4e, 0x45, 0x53, 0x1a, 8, 0, 0x70, 0]);
rom[16 + 0x10000] = 0x42; // bank 2 的首字节
const cart = new Cart(rom);
cart.writePRG(0x8000, 2);
console.log('选 bank 2 后：', cart.prgBank, cart.readPRG(0x8000));
cart.prgBank = 2;
console.log('手动设置 bank 后：', cart.readPRG(0x8000));
cart.writePRG(0x8000, 0x10);
console.log('镜像状态：', cart.mirroring);
JS
```

本次实际结果依次为 `0 0`、`0`、`0`。正确访问 bank 2 时首字节应为 `66`（`0x42`）。这些结果确认的是**缺陷存在**，不代表兼容性测试通过。

## PPU / APU 限制

- CPU 执行指令后批量推进 PPU，寄存器访问和 NMI 的精细时序存在局限；不能据此保证任何游戏均不受影响。
- Sprite overflow 使用近似处理，未完整实现硬件的精灵评估行为。
- DMC 音频通道未实现，依赖该通道的采样音效可能缺失。
- Mapper 0/1/2/3/66 有实现，但本次没有全面验证其正确性。

## 本次验证与范围

- 所有上传的 `.js` 文件均通过 `node --check`。
- `node tests/cpu_selftest.js` 返回 `CPU OPCODE SELF-TEST: ALL OK`。脚本只检查参考表定义的操作码并做行为抽查，不能解释为全部 256 种操作码或所有边界情况均已验证。
- 上述 AxROM 最小复现已实际执行。
- `index.html`、`css/style.css` 和七个核心 JS 文件共九个文件，与原始 ZIP 逐字节一致。
- 本次未重新运行需要外部 ROM 的 blargg 全量测试、Chrome 图像测试或真实游戏测试。旧开发记录不作为本次通过率。

## 发布检查

本次检查未发现待发布文件中的凭据；仓库未包含 ROM、原始调试日志或像素转储。此检查不是全面安全审计。原有开发脚本中的临时目录需使用者自行调整，参见 [测试目录说明](../tests/README.md)。
