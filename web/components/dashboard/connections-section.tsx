"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Cable,
  LogOut,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePanel } from "@/components/panel-provider";
import { apiRequest } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Connection } from "@/lib/types";
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  Pagination,
  selectClassName,
} from "./panel-ui";

const protocols = ["srt", "hls", "webrtc", "rtsp", "rtsps", "rtmp", "rtmps"];
export function ConnectionsSection() {
  const { can, preferences, refresh, toast } = usePanel();
  const params = useSearchParams();
  const [path, setPath] = useState(params.get("path") ?? "");
  const [protocol, setProtocol] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [kicking, setKicking] = useState<Connection | null>(null);
  const query = new URLSearchParams();
  if (protocol) query.set("protocol", protocol);
  if (path) query.set("path", path);
  const resource = useResource<Connection[]>(
    "/connections?" + query.toString(),
    preferences.refreshInterval,
    true,
  );
  useEffect(() => {
    setPath(params.get("path") ?? "");
    setPage(1);
  }, [params]);
  const items = resource.data ?? [];
  const filtered = items.filter(
    (connection) =>
      (!state ||
        (state === "idle"
          ? connection.state !== "publish" && connection.state !== "read"
          : connection.state === state)) &&
      [connection.id, connection.remoteAddr, connection.path]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / preferences.pageSize)),
  );
  const visible = filtered.slice(
    (currentPage - 1) * preferences.pageSize,
    currentPage * preferences.pageSize,
  );
  const unavailable = resource.meta?.unavailableProtocols ?? [];
  return (
    <>
      <ErrorNotice message={resource.error} onRetry={resource.reload} />
      {unavailable.length > 0 && (
        <div
          role="status"
          className="mb-5 rounded-xl border border-[#e8b86d]/30 bg-[#e8b86d]/10 px-4 py-3 text-xs leading-6 text-[#9b7840]"
        >
          以下协议未启用或不可用：
          {unavailable.map((item) => item.toUpperCase()).join("、")}
          。统计仅包含可用协议。
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          {
            label: "发布连接",
            value: items.filter((item) => item.state === "publish").length,
            icon: ArrowUpRight,
            color: "text-[#4a9d9a]",
          },
          {
            label: "读取连接",
            value: items.filter((item) => item.state === "read").length,
            icon: ArrowDownLeft,
            color: "text-[#e8b86d]",
          },
          {
            label: "空闲连接",
            value: items.filter(
              (item) => item.state !== "publish" && item.state !== "read",
            ).length,
            icon: Cable,
            color: "text-[#6b8e8e]",
          },
        ].map((item) => (
          <Card
            key={item.label}
            className="flex items-center justify-between p-5"
          >
            <div>
              <p className="text-xs text-gray-400">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold">
                {resource.data ? item.value : "—"}
              </p>
            </div>
            <item.icon className={"h-5 w-5 " + item.color} />
          </Card>
        ))}
      </div>
      <Card className="p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">会话列表</h2>
          <p className="mt-1 text-xs text-gray-400">按协议与路径查看当前连接</p>
        </div>
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              aria-label="搜索连接"
              className="pl-10"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="搜索 IP、路径或会话 ID…"
            />
          </div>
          <select
            aria-label="连接协议"
            className={selectClassName}
            value={protocol}
            onChange={(event) => {
              setProtocol(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部协议</option>
            {protocols.map((value) => (
              <option value={value} key={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            aria-label="连接状态"
            className={selectClassName}
            value={state}
            onChange={(event) => {
              setState(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            <option value="publish">发布</option>
            <option value="read">读取</option>
            <option value="idle">空闲</option>
          </select>
          <Input
            aria-label="精确路径过滤"
            className="w-full sm:w-52"
            value={path}
            onChange={(event) => {
              setPath(event.target.value);
              setPage(1);
            }}
            placeholder="精确路径，例如 live/camera"
          />
        </div>
        {!resource.data ? (
          <EmptyState loading={resource.loading} title="未能加载连接列表" />
        ) : !filtered.length ? (
          <EmptyState
            title="暂无匹配连接"
            description="连接媒体发布者或读取者后，会话将在这里显示。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>连接 / 路径</TableHead>
                <TableHead>协议</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>远端地址</TableHead>
                <TableHead>流量</TableHead>
                <TableHead>创建时间</TableHead>
                {can("connection.kick") && <TableHead>操作</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((connection) => (
                <TableRow
                  key={connection.protocol + "/" + connection.id}
                  className="hover:bg-[#faf8f5]"
                >
                  <TableCell>
                    <p className="max-w-48 break-all text-sm font-medium text-gray-700">
                      {connection.path || "未绑定路径"}
                    </p>
                    <p className="mt-1 max-w-48 break-all font-mono text-[10px] text-gray-400">
                      {connection.id}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-[#faf8f5] text-gray-500">
                      {connection.protocol.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        connection.state === "publish"
                          ? "bg-[#4a9d9a]/10 text-[#438e8b]"
                          : connection.state === "read"
                            ? "bg-[#e8b86d]/15 text-[#9b7840]"
                            : "bg-gray-100 text-gray-500"
                      }
                    >
                      {connection.state === "publish"
                        ? "发布"
                        : connection.state === "read"
                          ? "读取"
                          : "空闲"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-gray-500">
                    {connection.remoteAddr || "—"}
                  </TableCell>
                  <TableCell>
                    <p className="whitespace-nowrap text-xs text-gray-500">
                      接收 {formatBytes(connection.bytesReceived)}
                    </p>
                    <p className="mt-1 whitespace-nowrap text-xs text-gray-400">
                      发送 {formatBytes(connection.bytesSent)}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-gray-500">
                    {formatDate(connection.createdAt)}
                  </TableCell>
                  {can("connection.kick") && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-[#c17767]"
                        aria-label={"断开 " + connection.id}
                        onClick={() => setKicking(connection)}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        断开
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {resource.data && (
          <Pagination
            page={currentPage}
            pageSize={preferences.pageSize}
            total={filtered.length}
            onChange={setPage}
          />
        )}
        <p className="mt-4 text-xs leading-5 text-gray-400">
          HLS 按真实会话统计，RTSP 按 session
          统计。断开发布者会影响该流的读取者。
        </p>
      </Card>
      {kicking && (
        <ConfirmDialog
          title="断开此连接？"
          description={
            kicking.protocol.toUpperCase() +
            " · " +
            (kicking.path || "未绑定路径") +
            " · " +
            kicking.remoteAddr +
            "。会话将立即断开，客户端可能自动重连。"
          }
          label="断开连接"
          onClose={() => setKicking(null)}
          onConfirm={async () => {
            await apiRequest(
              "/connections/" +
                encodeURIComponent(kicking.protocol) +
                "/" +
                encodeURIComponent(kicking.id),
              { method: "DELETE" },
            );
            setKicking(null);
            toast("连接已断开");
            refresh();
          }}
        />
      )}
    </>
  );
}
