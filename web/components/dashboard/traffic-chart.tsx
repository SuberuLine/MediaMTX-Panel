"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/components/panel-provider";
import { formatBitrate } from "@/lib/format";
import type { TrafficPoint } from "@/lib/types";

export function TrafficChart() {
  const { history } = usePanel();
  const [windowMinutes, setWindowMinutes] = useState(5);
  const [hovered, setHovered] = useState<TrafficPoint | null>(null);
  const latest = history.at(-1);
  const end = latest ? Date.parse(latest.at) : Date.now();
  const points = history.filter(
    (point) => Date.parse(point.at) >= end - windowMinutes * 60000,
  );
  const start = points.length ? Date.parse(points[0].at) : end;
  const maximum = Math.max(
    1,
    ...points.flatMap((point) => [point.inBitrate ?? 0, point.outBitrate ?? 0]),
  );
  const x = (point: TrafficPoint) =>
    92 + ((Date.parse(point.at) - start) / Math.max(1, end - start)) * 592;
  const y = (value: number) => 186 - (value / maximum) * 148;
  function line(key: "inBitrate" | "outBitrate") {
    let connected = false;
    return points
      .map((point) => {
        if (point[key] === null) {
          connected = false;
          return "";
        }
        const segment =
          (connected ? "L" : "M") + x(point) + "," + y(point[key]);
        connected = true;
        return segment;
      })
      .join(" ");
  }
  const selected = hovered && points.includes(hovered) ? hovered : latest;
  return (
    <Card className="h-full p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">实时码率</h2>
          <p className="mt-1 text-xs text-gray-400">
            当前登录期间采集的路径媒体数据
          </p>
        </div>
        <div className="flex gap-1 rounded-xl bg-[#faf8f5] p-1">
          {[1, 5, 10].map((minutes) => (
            <Button
              key={minutes}
              variant="ghost"
              size="sm"
              className={
                windowMinutes === minutes
                  ? "bg-[#4a9d9a] text-white hover:bg-[#438e8b] hover:text-white"
                  : ""
              }
              onClick={() => setWindowMinutes(minutes)}
            >
              {minutes} 分钟
            </Button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <span className="flex items-center gap-2 text-gray-500">
          <span className="h-2 w-2 rounded-full bg-[#4a9d9a]" />
          接收{" "}
          <strong className="font-medium text-gray-700">
            {formatBitrate(selected?.inBitrate)}
          </strong>
        </span>
        <span className="flex items-center gap-2 text-gray-500">
          <span className="h-2 w-2 rounded-full bg-[#e8b86d]" />
          发送{" "}
          <strong className="font-medium text-gray-700">
            {formatBitrate(selected?.outBitrate)}
          </strong>
        </span>
        {selected && (
          <span className="ml-auto text-gray-400">
            {new Date(selected.at).toLocaleTimeString("zh-CN", {
              hour12: false,
            })}
          </span>
        )}
      </div>
      {points.length < 2 ? (
        <div className="flex h-56 flex-col items-center justify-center gap-3 text-gray-400">
          <Activity className="h-6 w-6 text-[#4a9d9a]/60" />
          <span className="text-xs">
            {points.length ? "等待下一次采样…" : "等待指标采样…"}
          </span>
        </div>
      ) : (
        <svg
          viewBox="0 0 720 220"
          className="h-auto min-h-40 w-full"
          role="img"
          aria-label="接收与发送码率趋势图，采样失败处显示间断"
        >
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction}>
              <line
                x1="92"
                x2="684"
                y1={y(maximum * fraction)}
                y2={y(maximum * fraction)}
                stroke="#f0eeeb"
                strokeDasharray="4 5"
              />
              <text
                x="83"
                y={y(maximum * fraction) + 4}
                textAnchor="end"
                fill="#9ca3af"
                fontSize="10"
              >
                {formatBitrate(maximum * fraction)}
              </text>
            </g>
          ))}
          <path
            d={line("inBitrate")}
            fill="none"
            stroke="#4a9d9a"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={line("outBitrate")}
            fill="none"
            stroke="#e8b86d"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {points.map(
            (point, index) =>
              point.inBitrate !== null && (
                <g
                  key={point.at}
                  tabIndex={0}
                  role="button"
                  aria-label={
                    new Date(point.at).toLocaleTimeString("zh-CN") +
                    " 接收 " +
                    formatBitrate(point.inBitrate) +
                    " 发送 " +
                    formatBitrate(point.outBitrate)
                  }
                  onMouseEnter={() => setHovered(point)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(point)}
                  onBlur={() => setHovered(null)}
                >
                  <rect
                    x={x(point) - 8}
                    y="25"
                    width="16"
                    height="168"
                    fill="transparent"
                  />
                  <circle
                    cx={x(point)}
                    cy={y(point.inBitrate)}
                    r={hovered === point ? 4 : points.length < 30 ? 2.5 : 1.5}
                    fill="#4a9d9a"
                  />
                  <title>{"第 " + (index + 1) + " 次采样"}</title>
                </g>
              ),
          )}
          <text x="92" y="211" fill="#9ca3af" fontSize="10">
            {new Date(start).toLocaleTimeString("zh-CN", { hour12: false })}
          </text>
          <text x="684" y="211" textAnchor="end" fill="#9ca3af" fontSize="10">
            {new Date(end).toLocaleTimeString("zh-CN", { hour12: false })}
          </text>
        </svg>
      )}
      <p className="mt-3 text-[11px] leading-5 text-gray-400">
        采样中断会显示间隔。图表随页面刷新更新，刷新页面后重新开始积累。
      </p>
    </Card>
  );
}
