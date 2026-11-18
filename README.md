# TopBar Pets 3.0 (GNOME 顶部栏多宠养成与 2.5D 联机对战插件)

适用于 **GNOME Shell 45 – 50+**（原生支持 Wayland & X11）的顶部栏多宠陪伴、跨流派自由构筑、2.5D 无边框透明自动战场与零配置局域网联机扩展（UUID: `topbar-pet@local.gnome-extension`）。

---

## ✨ 3.0 核心特性

### 1. ⚔️ 桌面顶层无边框 2.5D 透明自动战场 & 可展开实时战报
- **100% 自动战斗 + 100% 鼠标穿透透明舞台**：660×224 的 2.5D `(X, Z, JumpH)` 战场直接悬浮于桌面最上方，整片交战区域完全鼠标穿透不挡软件操作；顶部配备**等宽对齐的灵动胶囊控制条**（支持整体拖拽移动、固定宽度防文字撑开、点击 **「📋 详情 ▾」** 一键展开实时参战状态与可滚轮翻阅的完整战报日志）。
- **组件化技能引擎（42 种技能）与 4 槽跨流派自由配招**：每个技能由「位移前摇 + 2.5D 投射形态 + 元素异常词条」自由组合驱动（含垫步连斩、裂地跃击、瞬步背刺、抛物线滚石、地面持续陷阱、天降打击与贯穿光束）；每只宠物支持 **3 主动槽 + 1 奥义槽** 跨流派自由装配（同流派享 `+15%` 本命专精加成），内置一键推荐配招。
- **7 大元素连携反应**：烈焰/寒冰/雷霆/暗影/森毒/圣光互相挂附着并引爆 **💥融化高爆、⚡超导破甲、🌪️超载雷爆、☠️剧毒爆燃、✨光暗湮灭、🔮超激化、🧊霜蔓封锁**，配合 `xN COMBO` 像素连击特效与 Z 轴侧闪、下蹲潜避、0.25s 精准弹反（Perfect Parry）。
- **多元对战玩法**：支持 **1v1 副将闪现援助**、**2v2 元素双打**、**5 大随机深渊 Boss 副本（伴随多波次专属机制杂兵增援）** 以及顶部栏全员围殴 **世界 Boss**。

### 2. 💎 Roguelite 圣物工坊、神秘孵蛋与荣誉头衔
- **18 件战斗与养成圣物 + 4 大 AI 战术姿态**：每只宠物可装配最多 3 件圣物（如吸血鬼之牙、雷神战鼓、荆棘反伤铁甲、涅槃不死火羽）并设定专属 AI 姿态（均衡大师 / 狂暴突进 / 弹反宗师 / 灵巧风筝）。
- **零遮挡神秘宠物蛋孵化**：神秘宠物蛋内嵌于插件自身顶部栏胶囊徽章中孵化，**绝不遮挡或挤压任何系统/第三方托盘图标**，破壳必带天生稀有词条（✨闪光异色 / ⚡天生神速 / 💥狂暴血统等）。
- **12 项成就与局域网头衔**：达成弹反、元素连携、Boss 讨伐等里程碑自动解锁金色头衔并同步给局域网伙伴。

### 3. 🧗 全屏自由漫游 2.0、多宠防乱飞编导与高负载省电
- **丰富漫游动作**：新增窗口屋顶跑酷跨跳、窗口侧边框攀爬、抓钩钟摆荡秋千 (`🪝`)、传送门闪现、流派专属滑翔翼以及屏幕角落双宠篝火露营 (`🔥`)。
- **4 层防乱飞秩序治理 (`RoamDirector`)**：支持配置全屏漫游名额轮换（默认最多 `4` 只，其余乖巧留守顶部栏）、空中动作并发锁（同时 `≤ 2` 只）、单窗口驻足上限、当前焦点工作窗口顶边自动半透明避让（`opacity: 110`）以及一键 **「🎺 集合哨」** 全员归队。
- **办公情境陪伴 & 高 CPU 静音省电模式**：支持 **25 分钟番茄钟专注远征**；当检测到系统高负载（CPU ≥ 70%）时**绝不加速添乱**，而是自动进入静音省电模式（暂停全屏漫游与粒子，降频安静趴卧）。

### 4. 🎨 12行×4列全流派通用 AI 提示词工坊 & 🌐 局域网 2v2 / 合作讨伐
- **升级版 AI 精灵图生成提示词**：新增第 11、12 行通用施法与蓄力帧，导入任意自制宠物后装备跨流派魔法/圣盾均自然流畅（向下完美兼容旧版 10×4 精灵图与 GIF）。
- **零配置局域网联机**：UDP `49271` 自动发现 + TCP 确定性同步，支持向局域网好友发送 **1v1 决斗、2v2 双打、双人合作讨伐随机深渊 Boss** 及赠送金币礼物。

---

## 📂 目录结构

```text
topbar-pets/
├── metadata.json                   # 扩展元数据 (GNOME Shell 45–50)
├── extension.js                    # 扩展主生命周期与独立设置启动桥接
├── prefs.js                        # 标准 GNOME ExtensionPreferences 入口
├── stylesheet.css                  # 擂台 HUD、防遮挡气泡、升级横幅与名牌样式
├── schemas/                        # GSettings 配置定义与编译产物
├── src/
│   ├── compat.js                   # GNOME 45–51+ Cogl / St / Chrome 兼容层
│   ├── skillSystem.js              # 42 种组件化 2.5D 技能引擎、7 大元素连携反应与 4 槽自由配招
│   ├── relicsAndAchievements.js    # 18 件圣物、4 大战术姿态、5 大随机深渊 Boss 与 12 项成就
│   ├── rpg.js                      # 6 大职业流派、小队金币/孵蛋养成与 12×4 通用 AI 提示词工坊
│   ├── spriteLoader.js             # 10/12 行自适应精灵切片器、GIF 解析与智能纯色背景抠图
│   ├── perception.js               # 顶部栏控件扫描、窗口边框/屋顶拓扑与开发/文档办公情境感知
│   ├── petActor.js                 # 自由漫游 2.0（跨窗跳跃/抓钩摆荡/传送门/滑翔翼）与互动 AI
│   ├── petStageManager.js          # RoamDirector 防乱飞编导、高 CPU 省电静音、世界 Boss 与篝火调度
│   ├── battleArena.js              # 桌面顶层无边框 2.5D 透明战场与可展开实时战报面板
│   ├── lanManager.js               # UDP 自动发现、自定义皮肤同步与 1v1 / 2v2 / Boss 合作信令
│   ├── effects.js                  # PixelFX 爆发、成就/任务横幅与双气泡限流防遮挡引擎
│   ├── panelMenu.js                # 紧凑手风琴式状态栏控制菜单与零遮挡孵蛋胶囊徽章
│   ├── prefsBuilder.js             # Libadwaita 5 标签页构筑工坊与配置管理界面
│   ├── systemMonitor.js            # 轻量异步 CPU / 内存监控
│   └── pixelfx/                    # 内置 patch-gg/pixelfx (116 特效注册) 与稀疏快速透明合成桥
├── assets/
│   ├── icons/pet-indicator-symbolic.svg
│   ├── sprites/                    # 6 款 48×48 像素精灵图与示例 GIF
│   └── tools/                      # 精灵生成脚本、局域网 2v2 模拟队友、独立 GTK4 设置启动器
└── scripts/
    ├── build.sh                    # 编译 Schema 并打包 .shell-extension.zip
    ├── install.sh                  # 一键编译、安装并注册启用扩展
    ├── release.sh                  # 一键更新版本号、打 Tag 并触发 GitHub Actions 发布 Release
    ├── dev-preview.sh              # Linux 原生免注销嵌套 GNOME Shell (--devkit) 实时预览
    ├── dev-wsl.sh                  # WSL2 Xtigervnc + noVNC 浏览器实时预览服务端
    └── dev-wsl.ps1                 # Windows 端一键拉起 WSL2 GNOME Shell 实时预览脚本
```

---

## 🚀 安装与使用指南

### 方式 A：直接下载 GitHub Release 安装包（推荐普通用户）
前往 [GitHub Releases](https://github.com/zhiyang66/topbar-pets/releases) 下载最新 `topbar-pet@local.gnome-extension.shell-extension.zip`：
```bash
gnome-extensions install --force topbar-pet@local.gnome-extension.shell-extension.zip
# Wayland 下首次安装注销重登一次桌面，之后启用即可：
gnome-extensions enable topbar-pet@local.gnome-extension
```
> **在线检测与一键更新**：安装后插件支持自动检测 GitHub Releases 新版本，也可随时在右上角菜单点击 **「🔍 检查插件更新」** 或在设置面板 **「联机·显示·更新」** 页点击 **「🚀 一键更新」** 在线覆盖升级！

### 方式 B：源码一键编译安装（开发者）
```bash
git clone git@github.com:zhiyang66/topbar-pets.git
cd topbar-pets
./scripts/install.sh
```
发布新版本 Release 只需执行一行命令（自动触发 GitHub Actions 打包上传 `.zip`）：
```bash
./scripts/release.sh 3.0.0 "feat(v3.0.0): 2.5D transparent arena, 42 modular skills, relics & Free Roam 2.0"
```

### 2. 免注销立即窗口化预览（开发调试模式）
```bash
# Ubuntu / Debian 如未安装 mutter-devkit 可先执行: sudo apt install mutter-dev-bin
./scripts/dev-preview.sh
```

### 3. 局域网联机防火墙提示（Ubuntu / UFW）
若两台电脑在同一 Wi-Fi / 局域网下未互相看到宠物，请检查系统防火墙是否拦截了局域网广播端口：
```bash
sudo ufw status
# 若为 active，放行局域网发现端口与同网段通信（按实际网段调整）：
sudo ufw allow 49271/udp
sudo ufw allow from 192.168.0.0/16
```

---

## 📜 致谢与许可
- 像素技能视觉特效内核基于 [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx)（MIT License）。
