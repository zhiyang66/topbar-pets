# TopBar Pets 2.0 (GNOME 顶部栏多宠养成与局域网对战插件)

适用于 **GNOME Shell 45 – 50+**（原生支持 Wayland & X11）的顶部栏多宠陪伴、RPG 流派养成与零配置局域网同屏对战扩展（UUID: `topbar-pet@local.gnome-extension`）。

---

## ✨ 核心特性

### 1. 🐾 多宠小队领养与放生（最多 3 只同屏）
- **最多同时领养 3 只宠物**：所有出战伙伴在顶部栏自由漫步、各自独立思考，支持随时切换 **👑 主战代表宠物** 或与放生的伙伴温情道别（`🍃 放生` 星光升空动画）。
- **内置 6 款 16-bit 精致像素萌宠（48×48 · 12 组动作态）**：🐱 像素橘猫、🐕 像素柴犬、💧 皇冠果冻史莱姆、🤖 赛博小机甲、🐲 烈焰小火龙、👻 星界小幽灵。
- **自定义精灵图 / GIF + ✨ AI 宠物提示词工坊**：内置中英文 AI 提示词生成器（严格对齐 10行×4列 施法/攻击/受击/潜行规范），导入白底或绿幕图片后**自动边缘洪水填充抠图变透明**，并支持局域网自动同步自定义皮肤。

### 2. 🤸 丰富的顶部栏图标互动、双宠编舞与桌面感知
- **实时桌面与窗口感知**：递归扫描顶部栏所有动态按钮/托盘图标，监听新启动软件与最大化窗口“屋顶”。
- **8 种宠物 ↔ 图标互动**：组合拳飞踢震动图标、助跑铁头功猛撞、蹬图标借力 360° 后空翻、给系统图标施放魔法加持、坐图标擦拭/晃脚丫、压低身躯蹑手蹑脚潜行、跨栏翻越、趴时钟取暖小憩。
- **9 种宠物 ↔ 宠物双人互动（支持自家伙伴 & 局域网串门访客）**：空中击掌 (`🙌`)、跳山羊翻越伙伴、双宠同步摇摆舞、武道拼刀弹反、元素法术共鸣、你追我赶捉迷藏、凑近说悄悄话（含 **2D 气泡防遮挡自动分列/上下瀑布流错层引擎**）、依偎打盹、贴贴蹭脸。
- **RunCat 系统负载联动**：异步读取 `/proc/stat`，高 CPU 负载自动触发涡轮冲刺陪跑。

### 3. ⚔️ 6 大 RPG 职业流派 × 36 种 PixelFX 像素技能与战术擂台
- **6 大流派**：`⚔️ 狂战武道`、`🔥 烈焰魔导`、`❄️ 凛冬冰霜`、`⚡ 雷霆幻影`、`🔮 星界奥术`、`✨ 圣光自然`，随陪伴与战斗升级解锁专属技能并弹出金色升级横幅。
- **出战入场编舞**：开战前参战宠物高喊战吼（*“我来也，看招 ⚔️”*），奔跑至顶部栏中央俯冲跃入擂台，战斗期间在顶部栏自动隐藏，战罢跃回顶部栏。
- **格斗级战术博弈 AI**：拒绝站桩互锤，内置 **低头下蹲躲飞行道具 + 升龙反击**、**举盾防御减伤**、**0.25s 精准弹反（Perfect Parry）震晕对手**、**后撤步差合闪避**、**角落翻滚绕背** 与真实飞行弹道特效（基于 MIT 开源 `patch-gg/pixelfx` 渲染）。

### 4. 🌐 零配置局域网无限同屏串门与同步决斗
- **UDP `49271` 自动广播发现 + 动态 TCP 直连**：同一局域网下的电脑自动互相发现，归一化坐标（`0.0 ~ 1.0`）自适应不同分辨率显示器。
- 点击顶部栏上的访客宠物即可挥爪问候或发起实时决斗（确定性随机种子保证双方画面每一帧下蹲、弹反、暴击 100% 同步）；内置单机模拟队友方便随时测试。

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
│   ├── rpg.js                      # 6 大职业流派、36 技能表、小队管理与 AI 提示词生成
│   ├── spriteLoader.js             # 12 态切片器、GIF 解析与 AI 纯色背景智能抠图
│   ├── perception.js               # 顶部栏全控件扫描与窗口/软件启动感知
│   ├── petActor.js                 # 宠物物理跳跃、8 种图标互动、9 种双宠编舞与耍宝 AI
│   ├── petStageManager.js          # 多宠同屏调度、局域网访客渲染与擂台入场/返场编舞
│   ├── battleArena.js              # 顶部中央战术擂台（下蹲/防御/弹反/绕背/飞行道具）
│   ├── lanManager.js               # UDP 自动发现、自定义皮肤同步与 TCP 对战信令
│   ├── effects.js                  # PixelFX 粒子爆发、升级提示与 2D 防遮挡多气泡排版引擎
│   ├── panelMenu.js                # 状态栏快捷控制菜单
│   ├── prefsBuilder.js             # Libadwaita 4 标签页管理界面构建器
│   ├── systemMonitor.js            # 轻量异步 CPU / 内存监控
│   └── pixelfx/                    # 内置 patch-gg/pixelfx 像素特效引擎与 Cogl 渲染桥
├── assets/
│   ├── icons/pet-indicator-symbolic.svg
│   ├── sprites/                    # 6 款 48×48 像素精灵图与示例 GIF
│   └── tools/                      # 精灵生成脚本、局域网模拟队友、独立 GTK4 设置启动器
└── scripts/
    ├── build.sh                    # 编译 Schema 并打包 .shell-extension.zip
    ├── install.sh                  # 一键编译、安装并注册启用扩展
    └── dev-preview.sh              # 免注销嵌套 GNOME Shell (--devkit) 实时预览窗口
```

---

## 🚀 安装与使用指南

### 1. 一键编译并安装到桌面
```bash
git clone git@github.com:zhiyang66/topbar-pets.git
cd topbar-pets
./scripts/install.sh
```
> **Wayland 首次安装说明**：GNOME Wayland 首次安装新扩展需**注销并重新登录一次桌面**（之后更新无需再注销），登录即可在顶部栏看到宠物。

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
