# 终末地·寻访模拟器 (Arknights: Endfield Gacha Simulator)

非官方《明日方舟：终末地》抽卡模拟器——桌面版（解压即用）+ 安卓 APK（离线内核），数据来自官方公告与社区 Wiki 交叉验证。

> 仅供学习交流与概率体验，与鹰角网络（Hypergryph）无关联；所有概率与规则以游戏内官方公示为准。

## 功能

- **全卡池模拟**：公测 1.0–1.6 全部 16 期角色寻访 + 16 期武库申领，含基础/启程/特殊池；软保底 P(n)=0.8%+5%×(n−65)、80 硬保底、跨池继承、单池 120 井、240 信物循环、加急十连等全部规则忠实还原
- **官方数据同步**：登录鹰角通行证（密码 / 短信验证码 / 官方 App 扫码），自动拉取真实寻访记录，本地算法分析（保底推断、欧非百分位、保底结构、消费折算）与未来预测（蒙特卡洛）
- **统计与规划**：抽卡历史、欧非评级、期望规划计算器、充值换算
- **图鉴**：干员配装 / 基质 / 材料刷取地点
- **卡池自动更新**：桌面版启动时自动抓取官方新卡池公告
- **隐私**：凭据仅内存直转官方服务器，不保存账号密码；抽卡记录仅存本机

## 使用

### 桌面版（Windows）
下载 Release 中的 `抽卡模拟器.zip`，解压后双击 `start.bat`（内置轻量 Node 运行时，无需安装任何依赖），浏览器打开 http://127.0.0.1:3276 。关闭方式：页脚「关闭服务」按钮 / `stop.bat` / 直接关闭窗口。

### 安卓 APK
下载 `终末地寻访模拟器.apk` 安装（需允许未知来源）。完全离线的模拟内核 + 按需联网的官方数据同步（原生网络桥直连官方接口）。

## 构建

### 桌面版
零依赖：`runtime\node.exe server.js`（或任意 Node 18+）。打包：`tools\make-package.ps1`。

### 安卓 APK
无需 Android Studio / Gradle，手工流水线：JDK 17+ + Android build-tools/platform（sdkmanager 安装）：

```bat
tools\gen-icon.py          # 生成启动图标（Pillow）
runtime\node.exe tools\build-apk.js
```

流水线：`build-apk-runtime.js` 生成离线内核（引擎打包 + 数据内嵌 + fetch 拦截适配器）→ aapt2 → javac → d8 → zipalign → apksigner。产物 `android\build\endfield-gacha-sim.apk`。详见 `android/README.md`。

### 测试
```bat
runtime\node.exe --test src\tests\engine.test.js src\tests\official.test.js
```

## 目录结构

```
├── server.js            # 桌面版零依赖服务（node:http）
├── src/engine/          # 抽卡引擎（纯函数、可注入 RNG）
├── src/official/        # 官方接口链路与数据分析
├── public/              # 前端（原生 ESM 单页，HUD 终端风）
├── android/             # APK 工程（WebView 壳 + 离线内核）
├── data/                # 卡池/干员/规则/经济/图鉴数据（含来源标注 SOURCES.md）
└── tools/               # 构建、打包、验收脚本
```

## 数据来源

官方寻访公告（endfield.hypergryph.com）、游戏内公示概率、BWiki / Gamekee 等社区整理；全部来源 URL 与「待核实」项见 `data/SOURCES.md`。启动时自动同步官方新卡池（桌面版）。

## License

仅供学习交流，禁止商用；数据版权归原作者所有。
