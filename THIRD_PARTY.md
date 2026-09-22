# 第三方声明 / Third-party notices

本仓库源码（`js/`、`css/`、`index.html`、`tests/`、`docs/` 中由本项目撰写的内容）使用 **MIT License**，见 [LICENSE](LICENSE)。

下列内容**不**适用 MIT，保留其原许可证；与本仓库一同分发属于「聚合发行」（mere aggregation），不改变各自权利状态。

## 内置 ROM（`roms/`）

均来自公开的 NES 测试 / homebrew 合集 [christopherpow/nes-test-roms](https://github.com/christopherpow/nes-test-roms)，**不含商业游戏 ROM**。

| 文件 | 项目 | 权利人 / 说明 | 许可证 |
|------|------|----------------|--------|
| `roms/240pee.nes` | 240p Test Suite (NES) | Artemio Urbina；NES 版 Damian Yerrick | GPL-2.0-or-later |
| `roms/nes15-NTSC.nes` | NES15 十五拼图 | Mathew Brenaman | BSD（见 `roms/nes15-LICENSE`） |
| `roms/nestest.nes` | nestest | Kevin Horton | 可自由用于模拟器测试与分发（见 `roms/nestest.txt`） |
| `roms/SimpleParallaxDemo.nes` | Simple Parallax Demo | nes-test-roms 收录的 homebrew 演示 | **原仓库未附带明确 OSI 文本**；当前按「常用于模拟器测试合集的自由分发 homebrew」一并收录。若你需要严格的许可证链，请替换或移出该文件 |

240p Test Suite 源码：<https://github.com/ArtemioUrbina/240pTestSuite>（GPL-2.0）。若你分发本仓库且包含 `240pee.nes`，请一并满足 GPL-2.0 对**该 ROM** 的源码提供义务（或改为不打包该 ROM）。

## 算法与资料参考（非代码拷贝）

- APU 非线性混音等行为参考 [NESdev wiki](https://www.nesdev.org/) 对 2A03/2C02 的公开硬件描述后自行实现。
- PPU 调色板为 NTSC 2C02 的 RGB 近似值，属硬件色彩的事实性描述，非美术资源拷贝。

## 商业 ROM

用户本地加载的商业 ROM（如任天堂作品）不在本仓库分发范围内，版权归各自权利人。
