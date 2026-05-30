# WxPusher Desktop

WxPusher Desktop 是 WxPusher 消息推送平台的桌面客户端，基于 Electron + React 构建，面向 macOS、Windows、Linux 提供实时消息接收、系统通知、消息查看、桌面托盘、开机自启和自动更新能力。

📖 完整产品文档请参阅：[WxPusher 官方文档](https://wxpusher.zjiecode.com/docs/)

## 功能特性

- **扫码登录**：通过 WxPusher 设备登录二维码完成桌面端设备注册，凭证由主进程持久化管理
- **实时推送**：主进程维护 WebSocket 长连接，接收服务端下发的 `PUSH_NOTE` 消息
- **消息管理**：支持消息列表、搜索、已读标记、批量删除、全部删除和消息详情展示
- **系统通知**：支持普通通知、静音通知、不弹通知三种模式，并提供 macOS / Windows 通知设置引导
- **后台驻留**：关闭窗口默认隐藏到后台，继续通过托盘和系统通知接收消息
- **开机自启**：支持 macOS、Windows、Linux，其中 Linux 使用 XDG Autostart 文件实现
- **自动更新**：通过后端版本接口作为更新总闸，结合 `electron-updater` 完成桌面端更新
- **内嵌页面**：通过 `BrowserView` 加载 WxPusher H5 页面，并提供登录态与环境配置桥接
- **开发者环境切换**：开发模式下可在设置页切换生产、测试或自定义 API / WebSocket / H5 地址

## 技术栈

| 类型 | 技术 |
|---|---|
| 桌面框架 | Electron 35 |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 + vite-plugin-electron |
| UI 组件 | Ant Design 5 + lucide-react |
| 状态管理 | Zustand |
| 样式 | SCSS + CSS Design Tokens |
| 持久化 | electron-store |
| 日志 | electron-log |
| 实时连接 | ws |
| 自动更新 | electron-updater + electron-builder |

## 项目结构

```text
wxpusher-desktop/
├── package.json                  # 依赖、开发脚本和打包脚本
├── package-lock.json             # npm 锁文件
├── LICENSE                       # 开源协议（中文）
├── LICENSE_EN                    # 开源协议（英文）
├── vite.config.ts                # Vite + Electron 多入口构建配置
├── tsconfig.json                 # TypeScript 配置
├── index.html                    # 渲染进程 HTML 入口
├── main.js                       # 桌面入口兼容文件
├── resources/
│   ├── icon.png                  # Windows / Linux 图标
│   └── icon.ico                  # Windows 图标
├── scripts/
│   ├── gen-app-icon.mjs          # 应用图标生成脚本
│   └── icon-master.png           # 图标源图
├── electron/
│   ├── main.ts                   # 主进程入口：初始化窗口、托盘、WS、通知、更新等
│   ├── preload.ts                # 渲染进程安全桥接 API
│   ├── preload-webview.ts        # BrowserView 内嵌页面桥接
│   ├── ipc/
│   │   ├── ipcChannels.ts        # IPC channel 常量
│   │   ├── ipcHandlers.ts        # 主进程 IPC 处理器
│   │   └── wsStatus.ts           # WebSocket 状态定义
│   ├── managers/
│   │   ├── ApiService.ts         # 后端 HTTP API 封装
│   │   ├── CredentialManager.ts  # 设备凭证与 pushToken 持久化
│   │   ├── WindowManager.ts      # 主窗口、BrowserView、窗口状态管理
│   │   ├── WsManager.ts          # WebSocket 连接、心跳、重连和降级轮询
│   │   ├── NotificationManager.ts # 系统通知与权限检测
│   │   ├── PreferencesManager.ts # 用户偏好和环境配置
│   │   ├── NetworkManager.ts     # 网络状态监听与 WS 重连
│   │   ├── UpdateManager.ts      # 自动更新流程
│   │   ├── ThemeManager.ts       # 系统主题同步
│   │   └── PushCheckManager.ts   # 推送状态检查
│   └── utils/
│       ├── csp.ts                # Electron CSP 配置
│       ├── linuxAutoLaunch.ts    # Linux 开机自启
│       └── platform.ts           # 平台、版本和资源路径工具
└── src/
    ├── main.tsx                  # React 渲染入口
    ├── App.tsx                   # 登录态初始化和路由
    ├── stores/appStore.ts        # Zustand 全局状态
    ├── types/index.ts            # 渲染进程类型和 electronAPI 声明
    ├── pages/
    │   ├── LoginView/            # 扫码登录页
    │   ├── MainView/             # 主界面、消息列表、消息详情、设置页
    │   └── components/           # Toolbar、通知 Banner、更新弹窗、窗口控制等
    └── styles/
        ├── design-tokens.css     # 设计变量
        └── global.scss           # 全局样式
```

## 核心流程

### 登录与设备注册

1. 渲染进程调用 `createLoginQrcode()` 获取登录二维码。
2. 用户扫码确认后，渲染进程调用 `login(code)`。
3. 主进程通过 `ApiService.registerDevice()` 注册桌面设备。
4. `CredentialManager` 在主进程保存 `deviceToken`、`deviceUuid` 和 `pushToken`，渲染进程不直接写入敏感凭证。
5. 登录成功后拉取完整用户设备信息，并连接 WebSocket。

### 消息接收

```text
wxpusher-server/ws-connect
  → WsManager(WebSocket)
  → WindowManager.sendToRenderer('ws:new-message')
  → Zustand 消息列表 prepend
  → NotificationManager.showNotification()
```

WebSocket 断开后会按退避策略重连；如果长时间未恢复，会启动消息列表轮询作为降级兜底。

### 消息详情与 H5 桥接

消息详情通过 `BrowserView` 加载 WxPusher H5 页面。`preload-webview.ts` 提供桥接能力，让 H5 能获取桌面端登录态、环境地址、Toast、页面跳转等能力。

### 自动更新

自动更新流程以服务端 `/api/device/version-update` 为唯一总闸：

1. 启动 10 秒后首次静默检查，之后每 4 小时检查一次。
2. 接口返回 `hasUpdate=false` 时不触碰 `electron-updater`。
3. 接口返回 `hasUpdate=true` 时，使用 `downloadUrl` 作为更新 feed。
4. 静默检查会后台下载，下载完成后提示重启；手动检查会即时展示结果。
5. 强制更新会以阻塞弹窗提示。

## 开发命令

```bash
cd wxpusher-desktop

# 安装依赖
npm install

# 启动开发环境
npm run dev

# 仅构建前端与 Electron 产物
npm run build

# 预览 Vite 构建产物
npm run preview

# 构建桌面安装包
npm run electron:build

# 按平台构建
npm run electron:build:mac
npm run electron:build:win
npm run electron:build:linux
```

开发模式默认连接测试环境：

```text
API: http://wxpusher.test.zjiecode.com
WS:  ws://wxpusher.test.zjiecode.com
H5:  http://wxpusher.test.zjiecode.com
```

打包后默认连接生产环境：

```text
API: https://wxpusher.zjiecode.com
WS:  wss://wxpusher.zjiecode.com
H5:  https://wxpusher.zjiecode.com
```

开发模式可在「设置 → 开发者选项 · 环境配置」中切换生产、测试或自定义地址，保存后会重载应用。

## 安全约定

- 渲染进程启用 `contextIsolation`、`sandbox`，禁用 `nodeIntegration` 和 `webviewTag`
- 仅通过 `preload.ts` 暴露白名单 `window.electronAPI`
- 登录凭证只在主进程中保存和更新，渲染进程不提供任意写凭证能力
- `openExternal`、`BrowserView`、WebView 桥接 URL 均需经过协议或来源白名单校验
- 偏好写入通过 IPC key 白名单限制，避免渲染进程覆盖敏感配置
- CSP 由主进程在运行时统一设置，兼容开发环境 Vite HMR

## 开源协议

本项目采用 **四川思明今创科技有限公司客户端开源协议**，主要条款如下：

- ✅ 可自由查看和审计全部源代码
- ✅ 可修改和编译用于个人/内部非商业用途
- ✅ 可向本项目提交代码贡献
- ✅ 可正常传播分发官方未修改版本
- ❌ 不得用于商业盈利活动
- ❌ 不得分发修改后的非官方版本
- ❌ 不得基于本项目开发竞品进行商业化

完整协议请参阅 [LICENSE](./LICENSE)（中文）/ [LICENSE_EN](./LICENSE_EN)（英文）。

## 注意事项

- 当前项目没有独立测试脚本，提交前至少执行 `npm run build` 做 TypeScript 与构建校验
- `node-mac-permissions` 是 macOS 通知权限检测的可选依赖，仅在 macOS 下懒加载
- Linux 开机自启依赖 XDG Autostart，移动 AppImage 或更新应用后会刷新 autostart 文件
- 关闭窗口不会退出应用，真正退出需走托盘菜单或系统退出流程
- 开发工具默认不自动打开，需要设置 `ELECTRON_OPEN_DEVTOOLS=1`
- 修改 IPC channel、`preload.ts` 暴露 API 或 `src/types/index.ts` 类型时，需要三处保持一致
- 修改 H5 桥接协议时，需要同步评估 `wxpusher-app-fe` 的桥接接口与桌面端 `preload-webview.ts`
