"use client";

import { useEffect } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Cable,
  CircleAlert,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePanel } from "@/components/panel-provider";
import { formatBitrate, formatBytes, formatDate } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Metrics } from "@/lib/types";
import { ErrorNotice } from "./panel-ui";
import { TrafficChart } from "./traffic-chart";

export function AnalyticsSection() {
  const { preferences, recordTraffic } = usePanel();
  const resource = useResource<Metrics>(
    "/metrics",
    preferences.refreshInterval,
  );
  useEffect(() => {
    if (resource.data)
      recordTraffic(
        resource.error ? { ...resource.data, stale: true } : resource.data,
      );
  }, [resource.data, resource.error, recordTraffic]);
  const metrics = resource.data;
  const cards = [
    {
      label: "接收码率",
      value: formatBitrate(metrics?.stale ? null : metrics?.inBitrate),
      hint: "当前媒体输入速率",
      icon: ArrowDownLeft,
      color: "text-[#4a9d9a]",
    },
    {
      label: "发送码率",
      value: formatBitrate(metrics?.stale ? null : metrics?.outBitrate),
      hint: "当前媒体输出速率",
      icon: ArrowUpRight,
      color: "text-[#e8b86d]",
    },
    {
      label: "累计接收",
      value: metrics ? formatBytes(metrics.bytesReceived) : "—",
      hint: "后端本次运行的观测累计",
      icon: Activity,
      color: "text-[#6b8e8e]",
    },
    {
      label: "累计发送",
      value: metrics ? formatBytes(metrics.bytesSent) : "—",
      hint: "后端本次运行的观测累计",
      icon: Activity,
      color: "text-[#c17767]",
    },
    {
      label: "路径读取者 / 会话",
      value: metrics ? metrics.readers + " / " + metrics.sessions : "—",
      hint: "路径读取者可能包含 HLS 转封装器",
      icon: Users,
      color: "text-[#4a9d9a]",
    },
    {
      label: "输入帧错误",
      value: metrics?.errors.toLocaleString("zh-CN") ?? "—",
      hint: "路径输入媒体帧错误累计",
      icon: CircleAlert,
      color: "text-[#c17767]",
    },
  ];
  return (
    <>
      <ErrorNotice message={resource.error} onRetry={resource.reload} />
      {metrics?.stale && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-[#e8b86d]/30 bg-[#e8b86d]/10 px-4 py-3 text-sm text-[#9b7840]"
        >
          指标采样已过期。累计值保留为最后已知值，等待采样恢复。
        </div>
      )}
      <div className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card
            key={card.label}
            className="p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">{card.label}</p>
              <card.icon className={"h-5 w-5 " + card.color} />
            </div>
            <p className="mt-4 text-2xl font-semibold text-gray-800">
              {card.value}
            </p>
            <p className="mt-3 text-xs leading-5 text-gray-400">{card.hint}</p>
          </Card>
        ))}
      </div>
      <TrafficChart />
      <Card className="mt-6 p-6">
        <div className="mb-5 flex items-center gap-3">
          <Cable className="h-5 w-5 text-[#6b8e8e]" />
          <h2 className="text-lg font-semibold">采样信息</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <p className="text-xs text-gray-400">采样状态</p>
            <div className="mt-2">
              <Badge
                className={
                  metrics?.stale
                    ? "bg-[#e8b86d]/15 text-[#9b7840]"
                    : "bg-[#4a9d9a]/10 text-[#438e8b]"
                }
              >
                {!metrics ? "等待采样" : metrics.stale ? "已过期" : "正常"}
              </Badge>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400">最近采样</p>
            <p className="mt-2 text-sm text-gray-600">
              {formatDate(metrics?.sampledAt)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">统计范围</p>
            <p className="mt-2 text-sm text-gray-600">
              路径媒体数据（path payload）
            </p>
          </div>
        </div>
        <p className="mt-5 border-t border-gray-100 pt-4 text-xs leading-6 text-gray-400">
          流量不包含物理网卡与 HLS HTTP
          封装开销。后端重启后累计值重新开始；采样间隙的流量无法恢复。
        </p>
      </Card>
    </>
  );
}
