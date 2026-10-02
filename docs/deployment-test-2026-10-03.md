# 测试环境验证报告

- 目标：`http://161.33.15.189:8083`
- 时间：2026-10-03 00:00–00:05，Asia/Shanghai（UTC+8）
- 方法：低频 HTTP 黑盒检查；使用用户提供的面板 admin 账号验证已认证操作。
- 上游实测版本：MediaMTX `v1.21.1`。
- 结论：主要管理流程通过；发现间歇性 HTTP 连接提前关闭，尚不能确认原因。

## 结果

| 分组 | 结果 | 覆盖内容 |
| --- | --- | --- |
| 未认证检查 | 35/35 通过 | healthz、readyz、OpenAPI、访问控制、伪造会话、跨站/跨源请求、JSON 校验、请求体上限 |
| admin 认证后检查 | 48/49 通过 | 登录、Cookie、会话轮换、CSRF、只读业务接口、分页、协议过滤、临时路径 CRUD、审计、登出 |
| 异常定向复测 | 4 次请求中 3 次返回预期 400、1 次断连 | 一个其他非法协议 + 三次相同 file source 请求 |

首轮合计 **83/84** 通过。没有把后续成功重试计为抹除首轮失败；存在下述待定位的间歇性问题。

## 已确认行为

- `/healthz` 返回 `200 {"data":{"status":"ok"}}`；`/readyz` 返回 `200 {"data":{"status":"ready"}}`。
- 部署的 OpenAPI 与工作区契约内容一致（比较时归一化换行符）。
- 业务读取接口、路径增删改和 kick 接口在未登录时均返回 401；伪造的会话同样被拒绝。
- 成功登录后浏览器式 CookieJar 可访问 `/auth/me`。Cookie 实测为 `HttpOnly`、`SameSite=Strict`、`Path=/`、`Secure=false`。
- 正确的同源登录有效；异源 Origin 与 `Sec-Fetch-Site: cross-site` 被拒绝。
- 已登录但缺少/错误 CSRF 的写请求返回 403；旧会话在重新登录后失效，旧 CSRF 无法用于新会话；登出撤销会话。
- 错误 JSON、重复字段、字段大小写变体、null 和超大请求体按约定拒绝。任意命令 hook 字段被拒绝。
- Instance、Dashboard、Streams、Connections、Path 配置、Metrics、Audit 接口读取成功。分页和各协议过滤通过。
- 临时路径使用带 `/camera` 的嵌套名称，经过 URL 编码的详情、配置与删除接口均正常。
- 创建 `maxReaders=3` 后 PATCH 为 `maxReaders=0`、`overridePublisher=false`，读回结果正确，未指定的 source 保持 publisher。
- 空 PATCH、负 maxReaders 和 null PATCH 被拒绝。
- 临时路径的成功 create/update/delete 均可在审计记录中读取。
- SRT/HLS/WebRTC/RTSP/RTMP 对不存在的 UUID 执行 kick 返回 404；没有踢出现有连接。
- Metrics 两次采样时间从 `2026-10-02T16:03:03.354439007Z` 推进至 `2026-10-02T16:04:28.35342467Z`，两次 `stale=false`。

## 间歇性异常

**触发请求**：已登录且提供有效 CSRF，向 `POST /api/v1/streams` 提交合法临时名称和非法 `source: "file:///invalid"`。

**预期**：HTTP 400，JSON 错误码 `VALIDATION_ERROR`。

**实际**：首轮请求收到 `Remote end closed connection without response`。对相同 source 再发三次请求：

1. 连接提前关闭，耗时约 **8.004 秒**。
2. HTTP 400 / `VALIDATION_ERROR`，约 238 ms。
3. HTTP 400 / `VALIDATION_ERROR`，约 209 ms。

另一个非法 source `invalid://host` 正常返回 HTTP 400，约 307 ms。期间其他接口继续成功，结束后 Dashboard 与 Metrics 仍正常。

这是已观察到的传输异常，不能认定为稳定的配置校验逻辑错误，也不能确认发生在后端、前置网关或网络链路。需要对照上述时段的后端访问/错误日志及前置代理日志，检查请求是否到达应用、是否存在连接超时、请求过滤或进程重启。此次没有改动后端实现来掩盖该问题。

## 环境状态与未覆盖项

- 实测共有 1 个 Stream 列表条目、0 个在线流、0 个发布者、0 个观看者；码率与计数为零与空闲状态相符。
- `unavailableProtocols` 为 `rtmps`、`rtsps`；列表明确标记不可用，没有把它们当成完整的零会话结果。
- 仅提供了 admin 面板账号，**未在此部署环境验证 operator/viewer 的角色隔离**。
- 没有真实媒体发布者/观看者，**未验证活跃会话踢出、非零码率正确性或协议媒体链路**。
- 未执行压测、登录限流阈值测试、服务重启后的持久化验证或上游故障注入。
- 当前为公网 HTTP，Cookie 关闭 Secure 使该测试 URL 能正常登录。上线前应配置 HTTPS 与 `MTXUI_SECURE_COOKIE=true`，并设置正确的外部 `MTXUI_ORIGIN`。

## 清理和复现

创建的唯一测试路径为 `mtxui-test-eb0cb8d16374/camera`，已删除，配置及流详情都返回 404；Dashboard 总数恢复为原先的 1。测试登录会话已退出。仅保留预期的测试审计记录，没有修改已有路径或断开现有连接。

复用脚本：

```powershell
python scripts/smoke_remote.py --base-url http://161.33.15.189:8083
python scripts/smoke_authenticated.py --base-url http://161.33.15.189:8083 --username admin
# 第二个命令交互式隐藏输入密码；也支持 MTXUI_TEST_PASSWORD 环境变量。
```

脚本执行低频请求，不扫描其他端口。不要在短时间内反复运行未认证脚本，以免测试用的无效登录占用每分钟登录限额。

本次完整记录保存在本地忽略目录 `.cache/remote-smoke.json`、`.cache/remote-auth-smoke.json`、`.cache/remote-recheck.json`。报告和脚本不包含实际密码、Cookie 或 CSRF token。
