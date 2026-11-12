# Crypto Float Remote

桌面行情浮窗的「远程数据源」版本。UI 与本地直连版一致，但不再直接连接交易所，而是连接自建的行情服务器（HTTP + WebSocket），适合多台机器共用一条行情链路，或让桌面端走公网服务器。

## 功能

- 无边框半透明浮窗，可拖动、右下角拖拽缩放，记住位置与尺寸
- 实时显示服务器推送的合约价格与 24h 涨跌幅
- 点击某一行展开 24h 最高 / 最低
- 搜索（走服务器 `/api/search`）、添加、删除、拖动排序币种
- 服务器地址可配置，带连接测试；断开时明确提示「服务不可达」并标红
- 状态区分两层：客户端到服务器的链路、服务器到交易所的行情
- 价格阈值提醒、60 秒急涨急跌提醒
- 独立设置小窗：不透明度、桌面模糊、窗口大小、服务器、提醒阈值、币种管理

## 后端要求

需要一个兼容 `api.md` 协议的行情服务（默认端口 8787）：

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 探活，设置里的连接测试使用 |
| `GET /api/state` | 行情源状态、最近数据时间 |
| `GET /api/contracts` | 合约目录（含 `pricePlace` 精度） |
| `GET /api/search?q=btc` | 搜索合约 |
| `GET /api/prices?symbols=` | 行情快照 |
| `WS /ws` | `snapshot` / `prices` / `state` / `contracts` / `subscribed` / `pong` / `error` |

客户端行为：连接后订阅本地币种列表，增删币种时发送 `subscribe` / `unsubscribe`，每 20 秒发送 `{ "op": "ping" }`，8 秒无 `pong` 则重建连接。

## 技术栈

| 用途 | 方案 |
| --- | --- |
| 桌面外壳 | Electron 45 |
| 渲染层 | 原生 HTML / CSS / JavaScript，无框架 |
| 远程数据 | `ws` 客户端 + `node:http/https` |
| 窗口特效 / 系统能力 | `koffi` 调用 Win32：亚克力模糊、鼠标左键状态 |
| 打包 | electron-builder 26（便携版单文件 exe） |

与本地版相比，不再依赖 `https-proxy-agent`（不直连交易所）。

## 目录结构

```
src/main/index.js        主进程：窗口、设置小窗、IPC、提醒、缩放
src/main/remote.js       远程数据层：WS 连接、心跳重连、订阅、HTTP 接口
src/main/acrylic.js      Win32 亚克力 / 模糊
src/main/cursor.js       Win32 左键状态
src/main/store.js        配置读写
src/preload/index.js     contextBridge 暴露 window.api
src/renderer/index.html  主窗结构
src/renderer/app.js      主窗逻辑
src/renderer/settings.*  独立设置窗
src/renderer/styles.css  主题与玻璃效果
```

## 运行

```bash
npm install
npm start
npm run dist
```

打包缓存不可写时指定可写目录：

```powershell
$env:ELECTRON_BUILDER_CACHE='D:\Code\.eb-cache'; npm run dist
```

## 服务器设置

默认地址 `http://127.0.0.1:8787`，也可填局域网或公网地址（如 `http://192.168.1.10:8787`）。

设置 → 服务器：

1. 输入地址（支持省略协议，自动补 `http://`；填 `ws://` 也会自动转换）
2. 点「连接」（回车等同点击）
3. 先用 `/health` 测试，通过才保存并重连；失败会提示原因且不覆盖原配置
4. 状态行实时显示：`已连接 · 行情实时` + 最近数据时间

## 状态显示

| 链路 | 行情 | 顶部显示 | 颜色 |
| --- | --- | --- | --- |
| 正常 | live | 实时 | 绿 |
| 正常 | stale / polling | 延迟 / 轮询 | 黄 |
| 正常 | offline | 上游断开 | 红 |
| 正常 | connecting | 连接中 | 黄 |
| 未连接 | — | 服务不可达 | 红（价格同时变红） |

悬停状态点可查看服务器地址、行情状态与最近数据时间。

## 配置存储

`%APPDATA%\crypto-float-widget-remote\config.json`，与本地版相互独立。

## 已知限制

- Win10 的 DWM 模糊不受圆角裁剪，开启「桌面模糊」会看到矩形底框，默认关闭
- `koffi` 仅支持 Windows
- 服务器需允许 TCP 8787（或自定义端口），局域网访问还需放行防火墙
- 后端不支持令牌时无需鉴权；如需公网暴露，建议在反向代理层加访问控制

## 相关项目

- `crypto-float-widget`：直接连接 Bitget 的本地直连版本
