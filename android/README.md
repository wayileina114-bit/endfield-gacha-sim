# 安卓 APK（离线版）

`终末地寻访模拟器.apk` — WebView 壳 + 内置离线内核，**完全离线**（未声明 INTERNET 权限），
包含全部 16+16 期历史卡池、抽卡引擎、统计分析、期望规划、图鉴与立绘（WebP 内嵌）。

- 包名 `com.endfield.gacha`，minSdk 24（Android 7.0+）
- 存档存于 WebView localStorage（按包名隔离，卸载即清空）
- 官方账号同步功能为存根（该功能需桌面版中转鹰角接口），应用内有提示

## 安装

直接把 apk 传到手机安装（需允许"安装未知来源应用"）。

## 构建（本机已完成的环境，无需 Android Studio）

工具链（首次已装好）：
- JDK 25：`C:\Program Files\Eclipse Adoptium\jdk-25.*`（Temurin MSI，已注册 PATH）
- Android SDK：`%LOCALAPPDATA%\Android\Sdk`（cmdline-tools 安装 platforms;android-35 / build-tools;35.0.0 / platform-tools / emulator / system-images）

构建命令（仓库根目录）：

```bat
runtime\node.exe tools\build-apk.js
```

流水线：`tools\build-apk-runtime.js` 生成离线内核（引擎 CommonJS 打包 + 数据内嵌 +
fetch 拦截适配器 + 立绘转 WebP 并哈希改名）→ aapt2 link → javac → d8 → 注入 dex →
zipalign → apksigner（`~/.endfield-android/debug.keystore`，密码 endfield123）。
产物：`android\build\endfield-gacha-sim.apk`。
注意 aapt2 不接受非 ASCII 路径/文件名，构建在 `%USERPROFILE%\.endfield-android\apkbuild` 舞台目录完成。

## 架构要点

- 前端与桌面版**同一套代码**：`android/assets/www` 由 `public/` 拷贝生成，唯一差异是
  `js/runtime-shim.js`（在 ESM 应用前加载）——它拦截 `fetch('/api/*')` 交给内置适配器
  `tools/apk-adapter.js`（忠实移植 server.js 的 API 组装逻辑），存档写 localStorage。
- 立绘路径经 `__APP_RUNTIME__.imgSrc()` 解析为打包资源（`ui.js` 构建期打补丁）。
- 一致性保证：`tools/test-apk-parity.js` 在 Node 中直跑适配层，与桌面服务端逐接口对账（16 项）。
