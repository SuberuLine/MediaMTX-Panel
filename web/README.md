# MediaMTX WebUI

中文管理界面沿用原有暖白背景、青绿主色、圆角卡片与 shadcn/ui 组件。所有业务数据来自同源 `/api/v1`，浏览器不直接访问 MediaMTX 管理接口。

支持：

- 用户名登录、服务端 HttpOnly Cookie、会话恢复、绝对到期退出、CSRF 写请求和真实登出。
- 概览：在线路径、发布/读取连接、接收/发送码率、版本、运行时长与最近审计。
- 流管理：完整列表搜索、状态过滤、分页、轨道详情、嵌套路径创建/编辑/删除。
- 路径配置：来源保留或显式更换、按需拉取、读取者限制、覆盖发布者、录像格式与时长。
- 连接管理：SRT/HLS/WebRTC/RTSP/RTSPS/RTMP/RTMPS、协议/状态/路径过滤、会话断开。
- 数据分析：真实指标、当前登录期间的码率曲线、采样过期与部分协议不可用提示。
- 审计：服务端分页、操作结果与当前页 CSV 导出（转义公式和引号）。
- 设置：当前账号和实例信息、路径配置 CRUD、浏览器刷新间隔和分页偏好。
- 权限：入口及操作按 `auth/me` 返回的 permissions 判断；直接访问无权限页面也会拒绝。
- 移动导航、加载/空状态、操作反馈、失败重试、带焦点约束的确认对话框。

用户/RBAC 管理、录像文件管理、持久化历史指标与播放器不属于当前 MVP。旧骨架的 `/dashboard/users`、`/dashboard/reports` 分别兼容到连接管理和审计内容。

## 开发

需要 Node.js 24 与 pnpm 11.22.0。在仓库根目录运行：

```powershell
pnpm --dir web install --frozen-lockfile
# 按根 README 启动 Go 后端，开发 HTTP 时设置 MTXUI_SECURE_COOKIE=false。
pnpm --dir web dev
```

开发界面默认位于 http://localhost:3000，Next 将 `/api/*` 代理到 `http://127.0.0.1:8083`。后端 origin 校验需要匹配开发页面来源；后端进程设置 `MTXUI_ORIGIN=http://localhost:3000`。如果改变开发端口，必须相应修改该值。代理目标可以通过启动 Next 时的 `MTXUI_DEV_BACKEND` 改为另一个**面板后端**地址。

## 生产构建

```powershell
pnpm --dir web build
$env:MTXUI_STATIC_DIR = (Resolve-Path web/out).Path
# 按根 README 设置 MediaMTX、管理员密码、Cookie 等配置：
go run ./cmd/server -config config.example.yaml
```

访问 Go 后端的 `/login`。Dockerfile 自动编译 UI 并将其置于 `/opt/panel/web`，运行镜像不依赖 Node.js。

使用 Next [静态导出](https://nextjs.org/docs/app/guides/static-exports)，构建后 `scripts/prepare-export.mjs` 把内联 hydration 脚本转为按内容哈希命名的同源脚本，保留执行顺序。可以使用 Go 原有的 CSP，无需放开内联脚本或 eval。Go 静态托管支持 `route.html`、`route/index.html` 和 Next 的分段数据目录，子页面可以直接打开或刷新。生产发布应覆盖整个 `out` 目录。

Cookie 和 CSRF token 不写入 localStorage；localStorage 只保存工作台偏好。PATCH 只提交修改字段，普通编辑不会回写脱敏来源。后端把 MediaMTX 的天数/零时长转换为可编辑的 Go 格式；`false` 和 `0` 可以显式提交。

## 验证

```powershell
pnpm --dir web typecheck
pnpm --dir web test
pnpm --dir web build
go test ./...
go vet ./...
```

前端测试覆盖会话请求、CSRF、跨页过滤、脱敏来源保留、零值 PATCH、时长校验、CSV 转义和 CSP 静态导出。真实 MediaMTX 测试方式见根 README。GitHub CI 包含前端类型检查、测试、生产构建以及后端测试。
