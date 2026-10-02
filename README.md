# MediaMTX Control Panel

面向 Web 管理界面的独立 Go 控制平面。提供稳定领域 API，在后端适配 MediaMTX Control API 和 Metrics；浏览器不接触上游管理端口，也不经过本服务转发媒体。

当前实现文档中的 **MVP**，包含中文 WebUI，对接 **MediaMTX v1.21.1 / Control API v3**。旧版本的部分字段做了兼容转换，但不宣称支持所有旧版本。

## 已实现

- 沿用暖白、青绿与圆角卡片风格的 WebUI：真实登录、概览、流与路径配置、连接管理、实时指标、审计日志及浏览器偏好。
- 基于服务端 permission 的导航与操作权限、会话恢复/到期退出、CSRF 写请求、表单校验、确认对话框、空状态及故障重试。
- Argon2id 密码、SQLite 用户、服务端 Session、HttpOnly Cookie、CSRF 和登录限流。
- 独立的 admin / operator / viewer 权限集合，HTTP 路由按 permission 检查。
- Instance、聚合 Dashboard、Stream 列表和详情、Path 配置 CRUD。
- SRT / HLS / WebRTC / RTSP / RTSPS / RTMP / RTMPS 会话列表、过滤及 kick。
- 定时 Metrics 采样、码率、累计观测流量、reader/session 数、路径帧错误计数。
- 持久化审计、SQLite 迁移、健康检查、优雅退出、可选同源静态前端托管。
- 内嵌 OpenAPI、Dockerfile、Compose 示例、双架构构建 CI。

## 本地启动

需要 Go 1.26+，以及开启 Control API 和 Metrics 的 MediaMTX。构建不需要 C 编译器或外部数据库。Go 模块路径目前为项目占位名称，发布到自己的仓库时可统一替换。

首次使用 WebUI 还需要 Node.js 24 与 pnpm 11.22.0，先执行 `pnpm --dir web install --frozen-lockfile` 和 `pnpm --dir web build`，然后设置 `MTXUI_STATIC_DIR` 为 `web/out` 的绝对路径。开发代理、前端验证与构建细节见 [web/README.md](web/README.md)。Docker 会自动构建并包含 WebUI。

```powershell
Copy-Item config.example.yaml config.yaml
# 仅本地 HTTP 开发关闭 Secure；生产保持 true，通过 HTTPS 反向代理访问。
$env:MTXUI_SECURE_COOKIE = 'false'
# 示例从隐藏输入读取；密码至少 12 字节，不提供默认管理员密码。
$adminSecret = Read-Host '首次管理员密码' -AsSecureString
$env:MTXUI_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $adminSecret).Password
go run ./cmd/server -config config.yaml
```

首次启动在空数据库中创建 `admin`。再次启动使用已有账号，不重置密码；可从运行环境移除 bootstrap 密码。默认监听 `:8083`，数据库为 `./data/app.db`。`GET /healthz` 检查本进程；`GET /readyz` 同时检查 SQLite 和 MediaMTX。

Linux/macOS：

```sh
read -rs -p 'Initial admin password: ' MTXUI_BOOTSTRAP_PASSWORD; echo
export MTXUI_BOOTSTRAP_PASSWORD MTXUI_SECURE_COOKIE=false
go run ./cmd/server -config config.example.yaml
```

生产构建：

```sh
CGO_ENABLED=0 go build -trimpath -o mediamtx-control ./cmd/server
```

## MediaMTX 配置

在 MediaMTX 的配置文件中启用管理接口，并使用**独立上游凭据**。下列是需要合并到已有配置的示例，保留你自己的媒体发布/读取用户：

```yaml
api: true
apiAddress: 127.0.0.1:9997
metrics: true
metricsAddress: 127.0.0.1:9998
authInternalUsers:
  - user: panel
    pass: REPLACE_WITH_RANDOM_API_SECRET
    ips: []
    permissions:
      - action: api
      - action: metrics
```

将该账号通过 `MTXUI_MEDIAMTX_USERNAME/PASSWORD` 和 `MTXUI_METRICS_USERNAME/PASSWORD` 提供给后端。这些是后端访问上游的服务凭据，**不是面板管理员账号**。

## 配置优先级

内置默认值 → `-config` 指定的 YAML → 环境变量。未知 YAML 字段、非法 URL 和不合理的超时/采样间隔会使启动失败。使用 [`config.example.yaml`](config.example.yaml) 作为模板；实际配置和 `.env` 已加入忽略列表。

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `MTXUI_LISTEN` | `:8083` |
| `MTXUI_DATABASE` | `./data/app.db` |
| `MTXUI_MEDIAMTX_URL` | `http://127.0.0.1:9997` |
| `MTXUI_MEDIAMTX_TIMEOUT` | `5s`，上限 `1m` |
| `MTXUI_MEDIAMTX_USERNAME` / `MTXUI_MEDIAMTX_PASSWORD` | 上游 API Basic Auth |
| `MTXUI_METRICS_URL` | `http://127.0.0.1:9998/metrics`；根 URL 自动补 `/metrics` |
| `MTXUI_METRICS_INTERVAL` | `5s`，最小 `1s` |
| `MTXUI_METRICS_USERNAME` / `MTXUI_METRICS_PASSWORD` | Metrics Basic Auth |
| `MTXUI_SECURE_COOKIE` | `true` |
| `MTXUI_SESSION_TTL` | `24h`，范围 `1m`–`720h`，绝对过期 |
| `MTXUI_ORIGIN` | TLS 代理后的外部 origin，例如 `https://panel.example.com`，无尾部 `/` |
| `MTXUI_STATIC_DIR` | 可选，已编译前端目录 |
| `MTXUI_BOOTSTRAP_USERNAME` | 首次建库使用，默认 `admin` |
| `MTXUI_BOOTSTRAP_PASSWORD` | 首次建库必须指定，12–1024 字节 |
| `MTXUI_USER_PASSWORD` | 仅用于 `-create-user` CLI |

反向代理需要保留 Host；TLS 终止时显式配置 `MTXUI_ORIGIN`。服务不信任任意 `X-Forwarded-For` / `X-Forwarded-Proto`；审计与登录限流使用直连 IP，因此多个客户端经过同一个代理时会共享 IP 限流。生产可在代理层补充按真实客户端的限流。

## API 使用

完整契约见 [`docs/openapi.yaml`](docs/openapi.yaml)，运行时也可访问 `/openapi.yaml`。所有业务成功响应使用 `data`，列表附带 `pagination`，错误使用 `error.code` / `error.message`。

```http
POST /api/v1/auth/login
Content-Type: application/json

{"username":"admin","password":"your-admin-password"}
```

保留响应中的 Session Cookie，并将 `data.csrfToken` 放入后续写请求的 `X-CSRF-Token`。页面刷新后，通过 `GET /api/v1/auth/me` 恢复用户和 CSRF 信息。Cookie 为 HttpOnly、SameSite=Strict，默认 Secure；不需要将会话 ID 放入 localStorage。只支持同源浏览器 API 调用。

```http
POST /api/v1/streams
Content-Type: application/json
Cookie: mtxui_session=...
X-CSRF-Token: ...

{"name":"live/camera","source":"publisher","maxReaders":10}
```

嵌套路径使用 `/api/v1/streams/live%2Fcamera`。列表参数 `page` 从 1 开始，`pageSize` 默认 50、最大 200。连接可按 `?protocol=srt&path=live%2Fcamera` 过滤。

| 接口 | 权限 |
| --- | --- |
| `GET /api/v1/dashboard` | `dashboard.read` |
| `GET /api/v1/instance` | `instance.read` |
| `GET /api/v1/streams[/{name}]` | `stream.read` |
| `POST/PATCH/DELETE /api/v1/streams...` | `stream.create/update/delete` |
| `GET /api/v1/connections` | `connection.read` |
| `DELETE /api/v1/connections/{protocol}/{id}` | `connection.kick` |
| `GET /api/v1/config/paths[/{name}]` | `config.read` |
| `POST/PATCH/DELETE /api/v1/config/paths...` | `config.update` |
| `GET /api/v1/metrics` | `metrics.read` |
| `GET /api/v1/audit-logs` | `audit.read` |

Path 可写字段为 `source`、`sourceOnDemand`、`maxReaders`、`record`、`recordFormat`、`recordSegmentDuration`、`recordDeleteAfter`、`overridePublisher`。PATCH 忽略未提供字段，支持显式 `false` 和 `0`，拒绝 `null`、未知字段和空 PATCH。时长使用 Go 格式（`30s`、`1h`、`24h`），不用 `1d`。上游还会执行配置语义校验。MVP 不暴露任意命令 hook 或录像文件路径。

配置查询会移除 source URL 中的用户名、密码与 query，并通过 `sourceHasCredentials` 告知前端。保留现有源时，不要回写这个经过脱敏的 source。

## 用户与权限

| 角色 | MVP 权限 |
| --- | --- |
| admin | 全部已实现业务接口 |
| operator | Dashboard、Instance、Stream 读取、连接读取/kick、Metrics |
| viewer | 仅 Dashboard 和 Stream 状态读取 |

operator 的录像权限已在权限集合中预留，录像接口在 Phase 2。权限定义集中在 `internal/auth/permissions.go`，Handler 不判断角色名。

目前通过本地 CLI 添加用户，用户管理 HTTP/UI 在 Phase 2：

```powershell
$userSecret = Read-Host '新用户密码' -AsSecureString
$env:MTXUI_USER_PASSWORD = [System.Net.NetworkCredential]::new('', $userSecret).Password
go run ./cmd/server -config config.yaml -create-user alice -role operator
Remove-Item Env:MTXUI_USER_PASSWORD
```

用户创建、登录、登出、Path 增删改及 kick 都记录审计。操作先提交 `pending` 意图，再记录最终结果；进程中断留下的 pending 记录需要对照上游确认。审计完成写入失败时请求返回错误，上游操作可能已经生效。不会记录密码、Cookie 或配置请求体。

## 统计与兼容边界

- 流列表合并配置与运行状态，因此包含离线路径；regex / `all_others` 也作为配置条目出现。Dashboard 的 total 与这个列表一致。
- HLS viewer 使用真实 HLS session；path 的 readers 可包含 HLS muxer，因此不等于浏览器人数。RTSP 以 session 为单位，避免重复统计 socket。
- 被关闭或不存在的协议 endpoint 会出现在 `unavailableProtocols`，不会冒充完整的零连接结果。其他上游错误返回统一 502。
- 码率采用路径层字节计数的差值 × 8 / 时间差，优先使用新字段，避免将旧字段、Path、Session、Connection 再次相加。
- 流量属于 **path payload**，不代表物理网卡流量。HLS 封装/HTTP 传输层开销不包含在此统计中。
- 内存累计值包含首次采样的上游计数；之后逐 series 计算增量，处理重置、状态标签变化和路径消失。后端重启后统计重新开始；采样间隙、上游重启前未采集的流量无法恢复。
- 采样失败/超时设置 `stale=true`、码率归零；恢复时重新建立基线，不虚构缺失区间的流量。`errors` 当前指路径 inbound frame errors。
- Path CRUD 修改 MediaMTX 的运行时配置，不改写它的 YAML。上游重启后的持久化配置管理/备份恢复属于后续阶段。

## Docker

```sh
cp .env.example .env
# 编辑 .env，填入已有 MediaMTX 的 API/Metrics 地址、上游账号密码和首次管理员密码，然后：
docker compose up --build -d
```

Compose 构建和启动包含静态 WebUI 的面板，不拉取或启动 MediaMTX；请先准备已有的 MediaMTX 并启用 Control API 和 Metrics。WebUI 与面板 API 共用宿主机 `127.0.0.1:8083`，容器内监听 `:8083`。SQLite 使用命名卷。运行镜像使用 UID/GID 10001；使用宿主 bind mount 时，需要保证数据库目录可写。

`.env` 中的 `MTXUI_MEDIAMTX_URL` 和 `MTXUI_METRICS_URL` 必须能从面板容器访问，用户名也可分别设置；`MTX_API_PASSWORD` 用于这两个上游接口的认证。默认地址通过 `host.docker.internal` 连接宿主机，Compose 已配置 `host-gateway` 映射。远程 MediaMTX 请改成实际可达地址；容器中的 `127.0.0.1` 指向面板容器自身。

上面的 MediaMTX 配置示例适用于后端直接运行在宿主机的情况。Linux 上通过 Docker bridge 访问宿主机时，MediaMTX 的 `apiAddress` / `metricsAddress` 需要监听容器可达的宿主机私有地址，配合认证与防火墙限制访问范围。

双架构镜像构建并导出本地 OCI 文件：

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t mediamtx-control:local --output type=oci,dest=mediamtx-control.tar .
```

CI 会运行测试、race、vet，并构建这两个平台的镜像，不发布到 registry。

## 验证

```sh
go test ./...
go vet ./...
# 在装有 C 编译器的受支持环境执行：
CGO_ENABLED=1 go test -race ./...
```

真实 MediaMTX 联调测试使用独立临时配置/SQLite 和 loopback 监听器，完成后停止测试进程：

```powershell
# 从官方 v1.21.1 release 下载程序并核对 checksums.sha256 后设置：
$env:MTX_TEST_BINARY = 'C:\path\to\mediamtx.exe'
go test ./internal/api -run TestRealMediaMTX -v
```

该测试覆盖上游认证、真实 Metrics、嵌套 Path CRUD、SRT/HLS/WebRTC/RTSP/RTMP 列表、Dashboard 和不存在会话的 kick。实际发布媒体后的活跃会话踢出需要部署环境端到端验证。

## 结构与后续范围

```text
cmd/server           启动、bootstrap、用户 CLI、优雅退出
internal/api         HTTP、权限中间件、JSON/CSRF、响应与静态托管
internal/auth        Argon2id、随机令牌、权限集合
internal/service     稳定领域模型、配置验证、聚合
internal/mediamtx    唯一构造 /v3 路径的 SDK 适配层
internal/metrics     独立采样、逐 series 差分、过期状态
internal/store/sqlite 用户、会话、迁移、审计存储
internal/audit       高风险操作审计生命周期
internal/config      YAML 与环境配置
migrations           嵌入二进制的 SQL 迁移
docs/openapi.yaml    API 契约，嵌入二进制
web                  Next.js / React 中文 WebUI、测试与静态导出
```

尚未实现：录像文件管理、全局/Raw 配置编辑器、用户/RBAC 管理 UI、API Token、OIDC、SSE/WebSocket、持久化历史流量图、多实例、Prometheus exporter。实时图表只积累当前登录期间的采样。没有转码、媒体代理或播放业务。

上游依据：[Control API](https://mediamtx.org/docs/references/control-api)、[Metrics](https://mediamtx.org/docs/features/metrics)、[v1.21.1 OpenAPI](https://github.com/bluenviron/mediamtx/blob/v1.21.1/api/openapi.yaml)。
