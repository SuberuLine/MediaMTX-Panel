"use client";

import Link from "next/link";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Radio,
  Server,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePanel } from "@/components/panel-provider";
import {
  formatBitrate,
  formatDate,
  formatUptime,
  actionLabels,
} from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { routes } from "@/lib/routes";
import type { Audit, Dashboard, Stream } from "@/lib/types";
import { AuditOutcome } from "./audit-section";
import { EmptyState, ErrorNotice, StatusBadge } from "./panel-ui";
import { TrafficChart } from "./traffic-chart";

export function OverviewSection({
  dashboard,
  loading,
  error,
  reload,
}: {
  dashboard?: Dashboard;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  const { can, preferences } = usePanel();
  const streams = useResource<Stream[]>(
    "/streams?pageSize=6",
    preferences.refreshInterval,
  );
  const audits = useResource<Audit[]>(
    can("audit.read") ? "/audit-logs?pageSize=5" : null,
    preferences.refreshInterval,
  );
  const traffic = dashboard?.traffic;
  const stats = [
    {
      label: "在线流",
      value: dashboard?.streams.online ?? "—",
      hint: dashboard
        ? "共 " + dashboard.streams.total + " 个流路径"
        : "等待实例数据",
      icon: Radio,
      className: "bg-[#4a9d9a]/10 text-[#4a9d9a]",
    },
    {
      label: "读取连接",
      value: dashboard?.connections.viewers ?? "—",
      hint: dashboard
        ? dashboard.connections.publishers +
          " 个发布连接 · " +
          dashboard.connections.idle +
          " 个空闲连接"
        : "等待会话数据",
      icon: Users,
      className: "bg-[#e8b86d]/15 text-[#c79a52]",
    },
    {
      label: "接收码率",
      value: formatBitrate(traffic?.stale ? null : traffic?.inBitrate),
      hint: traffic?.stale ? "采样已过期" : "路径媒体数据接收速率",
      icon: ArrowDownLeft,
      className: "bg-[#6b8e8e]/10 text-[#6b8e8e]",
    },
    {
      label: "发送码率",
      value: formatBitrate(traffic?.stale ? null : traffic?.outBitrate),
      hint: traffic?.stale ? "采样已过期" : "路径媒体数据发送速率",
      icon: ArrowUpRight,
      className: "bg-[#c17767]/10 text-[#c17767]",
    },
  ];
  return (
    <>
      <ErrorNotice message={error} onRetry={reload} />
      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-gray-500">{stat.label}</span>
              <div
                className={
                  "flex h-10 w-10 items-center justify-center rounded-xl " +
                  stat.className
                }
              >
                <stat.icon className="h-5 w-5" />
              </div>
            </div>
            <div className="text-3xl font-semibold tracking-tight text-gray-800">
              {stat.value}
            </div>
            <p className="mt-3 text-xs text-gray-400">{stat.hint}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <TrafficChart />
        </div>
        <Card className="p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#faf8f5]">
              <Server className="h-5 w-5 text-[#6b8e8e]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">实例状态</h2>
              <p className="mt-1 text-xs text-gray-400">MediaMTX 运行概况</p>
            </div>
          </div>
          {!dashboard ? (
            <EmptyState loading={loading} title="实例状态暂不可用" />
          ) : (
            <div className="space-y-5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">服务状态</span>
                <StatusBadge online={!error && dashboard.instance.online}>
                  {error ? "状态待更新" : dashboard.instance.online ? "在线" : "离线"}
                </StatusBadge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">版本</span>
                <span className="font-medium">
                  {dashboard.instance.version || "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">运行时长</span>
                <span>{formatUptime(dashboard.instance.uptime)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">指标采样</span>
                <Badge
                  className={
                    traffic?.stale
                      ? "bg-[#e8b86d]/15 text-[#9b7840]"
                      : "bg-[#4a9d9a]/10 text-[#438e8b]"
                  }
                >
                  {traffic?.stale ? "已过期" : "正常"}
                </Badge>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400">最近采样</p>
                <p className="mt-2 text-xs text-gray-600">
                  {formatDate(traffic?.sampledAt)}
                </p>
              </div>
              {dashboard.connections.unavailableProtocols?.length > 0 && (
                <p className="rounded-xl bg-[#e8b86d]/10 p-3 text-xs leading-6 text-[#9b7840]">
                  部分协议未启用，连接统计仅覆盖可用协议。
                </p>
              )}
            </div>
          )}
        </Card>
      </div>
      <Card className="mt-6 p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">流路径一览</h2>
            <p className="mt-1 text-xs text-gray-400">
              最近状态 · 按路径名称排序
            </p>
          </div>
          <Button asChild variant="link">
            <Link href={routes.dashboardSection("streams")}>
              查看全部
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        <ErrorNotice message={streams.error} onRetry={streams.reload} />
        {!streams.data ? (
          <EmptyState loading={streams.loading} title="未能加载流路径" />
        ) : !streams.data.length ? (
          <EmptyState
            title="还没有流路径"
            description="进入流管理，配置第一个媒体来源。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>路径名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>媒体轨道</TableHead>
                <TableHead>读取者</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {streams.data.map((stream) => (
                <TableRow key={stream.name} className="hover:bg-[#faf8f5]">
                  <TableCell className="max-w-64 break-all text-sm font-medium text-gray-700">
                    {stream.name}
                  </TableCell>
                  <TableCell>
                    <StatusBadge online={stream.online} />
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {stream.tracks?.map((track) => track.codec).join(" / ") ||
                      "—"}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {stream.readers}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={
                          routes.dashboardSection("streams") +
                          "?q=" +
                          encodeURIComponent(stream.name)
                        }
                      >
                        查看
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {can("audit.read") && (
        <Card className="mt-6 p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">最近操作</h2>
              <p className="mt-1 text-xs text-gray-400">最新的 5 条审计记录</p>
            </div>
            <Button asChild variant="link">
              <Link href={routes.dashboardSection("audit")}>
                全部记录
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
          <ErrorNotice message={audits.error} onRetry={audits.reload} />
          {!audits.data ? (
            <EmptyState loading={audits.loading} title="审计记录暂不可用" />
          ) : !audits.data.length ? (
            <EmptyState title="暂无操作记录" />
          ) : (
            <div className="divide-y divide-gray-50">
              {audits.data.map((audit) => (
                <div
                  key={audit.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4a9d9a]/10">
                    <Activity className="h-4 w-4 text-[#4a9d9a]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm text-gray-600">
                      <span className="font-medium text-gray-800">
                        {audit.user}
                      </span>
                      {" · " + (actionLabels[audit.action] ?? audit.action)}
                      {audit.resource && (
                        <span className="ml-2 text-gray-400">
                          {audit.resource}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {formatDate(audit.time)}
                    </p>
                  </div>
                  <AuditOutcome outcome={audit.outcome} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
