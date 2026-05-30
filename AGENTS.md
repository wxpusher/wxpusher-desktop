# wxpusher-desktop — 桌面客户端

## 固定首句

- 每次回复的第一句话必须是：`【识别到wxpusher-desktop/AGENTS.md】`

## 技术栈

- **桌面框架**：Electron 35
- **前端框架**：React 18 + TypeScript
- **构建**：Vite 6 + vite-plugin-electron + electron-builder
- **UI 组件**：Ant Design 5 + lucide-react
- **状态管理**：Zustand
- **样式**：SCSS + CSS Design Tokens
- **持久化**：electron-store
- **日志**：electron-log
- **实时连接**：ws
- **包管理**：npm（有 `package-lock.json`）

## 项目定位

WxPusher 桌面客户端，面向 macOS、Windows、Linux 提供实时消息接收、系统通知、消息列表、消息详情、桌面托盘、开机自启、推送检查、公告 Banner、自动更新等桌面端能力。

桌面端不是普通 Web 应用：安全边界在 Electron 主进程。登录凭证、WebSocket、系统通知、窗口、托盘、自动更新、开机自启等能力都在 `electron/` 中实现，渲染进程只能通过 `preload.ts` 暴露的白名单 API 访问。

## 详细功能

- **登录注册**：`LoginView` 生成扫码登录二维码，主进程调用 `/api/device/register-device` 注册设备，并由 `CredentialManager` 保存 `deviceToken` / `deviceUuid` / `pushToken`
- **实时消息**：`WsManager` 维护 WebSocket、心跳、读超时、退避重连和降级轮询，收到 `PUSH_NOTE` 后同时更新渲染层消息列表和系统通知
- **消息管理**：`MessagePage` / `MessageList` 支持列表加载、搜索、选中、已读、批量删除、全部删除；消息详情通过 `BrowserView` 加载 H5
- **系统通知**：`NotificationManager` 支持 normal / silent / quiet 三档通知行为，并分别处理 macOS、Windows、Linux 权限检测
- **窗口与托盘**：`WindowManager` 管理主窗口、窗口状态持久化、关窗隐藏到后台、BrowserView；托盘负责后台驻留入口
- **偏好配置**：`PreferencesManager` 基于 `electron-store` 保存用户偏好、窗口状态、通知模式、环境地址等
- **环境切换**：dev 模式设置页可切换生产、测试或自定义 `baseUrl` / `wsUrl` / `appFeUrl`，打包后默认强制生产地址
- **自动更新**：`UpdateManager` 先查后端 `/api/device/version-update`，再按需使用 `electron-updater` 下载和安装更新
- **安全 IPC**：`ipcHandlers.ts` 对偏好写入、外链打开、BrowserView URL、WebView 桥接等做白名单校验

## 目录结构

```text
wxpusher-desktop/
├── package.json                  # 依赖与脚本
├── package-lock.json             # npm 锁文件
├── vite.config.ts                # Vite + Electron 多入口配置
├── tsconfig.json                 # TypeScript 配置
├── index.html                    # 渲染进程 HTML 入口
├── main.js                       # 桌面入口兼容文件
├── resources/                    # 应用图标等静态资源
├── scripts/
│   ├── gen-app-icon.mjs          # 图标生成脚本
│   └── icon-master.png           # 图标源图
├── electron/
│   ├── main.ts                   # 主进程入口
│   ├── preload.ts                # 渲染进程桥接 API
│   ├── preload-webview.ts        # H5 BrowserView 桥接 API
│   ├── ipc/
│   │   ├── ipcChannels.ts        # IPC channel 常量
│   │   ├── ipcHandlers.ts        # IPC handler 注册
│   │   └── wsStatus.ts           # WebSocket 状态常量
│   ├── managers/
│   │   ├── ApiService.ts         # HTTP API 封装
│   │   ├── CredentialManager.ts  # 设备凭证管理
│   │   ├── WindowManager.ts      # 窗口与 BrowserView 管理
│   │   ├── WsManager.ts          # WebSocket 管理
│   │   ├── NotificationManager.ts # 系统通知管理
│   │   ├── PreferencesManager.ts # 偏好与环境配置
│   │   ├── NetworkManager.ts     # 网络状态监听
│   │   ├── UpdateManager.ts      # 自动更新
│   │   ├── ThemeManager.ts       # 主题同步
│   │   └── PushCheckManager.ts   # 推送状态检查
│   └── utils/
│       ├── csp.ts                # CSP 配置
│       ├── linuxAutoLaunch.ts    # Linux XDG 开机自启
│       ├── platform.ts           # 平台和资源路径工具
│       └── logger.ts             # 日志工具
└── src/
    ├── main.tsx                  # React 入口
    ├── App.tsx                   # 登录态初始化 + HashRouter
    ├── stores/appStore.ts        # Zustand 全局状态
    ├── types/index.ts            # 类型与 window.electronAPI 声明
    ├── pages/
    │   ├── LoginView/            # 登录页
    │   ├── MainView/             # 主界面、消息、设置
    │   └── components/           # Toolbar、Banner、UpdateModal、WindowControls 等
    └── styles/
        ├── design-tokens.css     # 设计变量
        └── global.scss           # 全局样式
```

## 开发命令

```bash
cd wxpusher-desktop

npm install                         # 安装依赖
npm run dev                         # 启动开发环境
npm run build                       # TypeScript + Vite 构建
npm run preview                     # 预览 Vite 构建产物
npm run electron:build              # 构建桌面安装包
```

开发模式默认连接测试环境：

```text
baseUrl = http://wxpusher.test.zjiecode.com
wsUrl = ws://wxpusher.test.zjiecode.com
appFeUrl = http://wxpusher.test.zjiecode.com
```

打包后默认连接生产环境：

```text
baseUrl = https://wxpusher.zjiecode.com
wsUrl = wss://wxpusher.zjiecode.com
appFeUrl = https://wxpusher.zjiecode.com
```

## 开发注意事项

- 改 IPC 时必须同步 `ipcChannels.ts`、`ipcHandlers.ts`、`preload.ts` 和 `src/types/index.ts`
- 不要让渲染进程直接保存或修改登录凭证，凭证逻辑应留在 `CredentialManager` 和主进程 IPC handler
- 新增 `electronAPI` 能力时必须保持白名单思路，避免暴露任意文件、命令、URL 或偏好写入能力
- 外链、BrowserView URL、WebView 桥接跳转必须做协议或 host 白名单校验
- `WindowManager` 关闭窗口的默认行为是隐藏到后台，真正退出需设置 `app.isQuitting`
- 修改 WebSocket 消息结构时，需要同步评估 `wxpusher-server/ws-connect` 的 `WsPushNoteMsg`
- 修改 H5 桥接协议时，需要同步评估 `wxpusher-app-fe` 的桥接接口
- 当前没有独立测试脚本，提交前至少运行 `npm run build`
- 开发调试主窗口 DevTools 需显式设置 `ELECTRON_OPEN_DEVTOOLS=1`
