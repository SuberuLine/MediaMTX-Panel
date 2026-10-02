"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  Eye,
  Pencil,
  Plus,
  Radio,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useResource } from "@/lib/use-resource";
import type { PathConfig, Stream } from "@/lib/types";
import { routes } from "@/lib/routes";
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  Modal,
  Pagination,
  StatusBadge,
  selectClassName,
} from "./panel-ui";
import { PathEditor } from "./path-editor";

export function StreamsSection() {
  const { can, preferences, refresh, toast } = usePanel();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ name: string | null } | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Stream | null>(null);
  const resource = useResource<Stream[]>(
    "/streams",
    preferences.refreshInterval,
    true,
  );
  useEffect(() => {
    setSearch(params.get("q") ?? "");
    setPage(1);
  }, [params]);
  const streams = resource.data ?? [];
  const filtered = streams.filter(
    (stream) =>
      stream.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (status === "all" || stream.online === (status === "online")),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / preferences.pageSize)),
  );
  const visible = filtered.slice(
    (currentPage - 1) * preferences.pageSize,
    currentPage * preferences.pageSize,
  );
  return (
    <>
      <ErrorNotice message={resource.error} onRetry={resource.reload} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          {
            label: "全部流路径",
            value: resource.data ? streams.length : "—",
            color: "text-[#6b8e8e]",
          },
          {
            label: "在线流",
            value: resource.data
              ? streams.filter((stream) => stream.online).length
              : "—",
            color: "text-[#4a9d9a]",
          },
          {
            label: "离线路径",
            value: resource.data
              ? streams.filter((stream) => !stream.online).length
              : "—",
            color: "text-[#c17767]",
          },
        ].map((item) => (
          <Card
            key={item.label}
            className="flex items-center justify-between p-5"
          >
            <div>
              <p className="text-xs text-gray-400">{item.label}</p>
              <p className="mt-2 text-2xl font-semibold">{item.value}</p>
            </div>
            <Radio className={"h-5 w-5 " + item.color} />
          </Card>
        ))}
      </div>
      <Card className="p-5 md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">流路径</h2>
            <p className="mt-1 text-xs text-gray-400">查看媒体状态与来源配置</p>
          </div>
          {can("stream.create") && (
            <Button onClick={() => setEditor({ name: null })}>
              <Plus className="h-4 w-4" />
              新建流
            </Button>
          )}
        </div>
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              aria-label="搜索流路径"
              placeholder="搜索路径名称…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              className="pl-10"
            />
          </div>
          <select
            aria-label="流状态"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className={selectClassName}
          >
            <option value="all">全部状态</option>
            <option value="online">在线</option>
            <option value="offline">离线</option>
          </select>
        </div>
        {!resource.data ? (
          <EmptyState loading={resource.loading} title="未能加载流列表" />
        ) : !filtered.length ? (
          <EmptyState
            title={streams.length ? "没有匹配的流" : "暂无流路径"}
            description={
              streams.length
                ? "试试其他路径名称或状态。"
                : can("stream.create")
                  ? "创建第一个路径，接入您的媒体来源。"
                  : "此实例尚未配置任何流路径。"
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>路径名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>媒体轨道</TableHead>
                <TableHead>读取者</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((stream) => (
                <TableRow key={stream.name} className="hover:bg-[#faf8f5]">
                  <TableCell>
                    <button
                      onClick={() => setDetail(stream.name)}
                      className="max-w-64 break-all text-left text-sm font-medium text-gray-700 hover:text-[#4a9d9a]"
                    >
                      {stream.name}
                    </button>
                    <p className="mt-1 text-xs text-gray-400">
                      {stream.sourceType ||
                        (stream.configured ? "已配置" : "运行时路径")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge online={stream.online} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {stream.tracks?.length ? (
                        stream.tracks.map((track, index) => (
                          <Badge
                            key={index}
                            className="bg-[#faf8f5] text-gray-500"
                          >
                            {track.codec}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {stream.readers}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={"查看 " + stream.name}
                        onClick={() => setDetail(stream.name)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {can("stream.update") &&
                        can("config.read") &&
                        stream.configured && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={"编辑 " + stream.name}
                            onClick={() => setEditor({ name: stream.name })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      {can("stream.delete") && stream.configured && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-[#c17767]"
                          aria-label={"删除 " + stream.name}
                          onClick={() => setDeleting(stream)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
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
      </Card>
      {editor && (
        <PathEditor name={editor.name} onClose={() => setEditor(null)} />
      )}
      {detail && (
        <StreamDetail
          name={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor({ name: detail });
            setDetail(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={"删除路径 " + deleting.name}
          description="删除后此路径的发布与读取可能中断。此操作无法撤销。"
          label="删除路径"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await apiRequest("/streams/" + encodeURIComponent(deleting.name), {
              method: "DELETE",
            });
            setDeleting(null);
            toast("路径已删除");
            refresh();
          }}
        />
      )}
    </>
  );
}

function StreamDetail({
  name,
  onClose,
  onEdit,
}: {
  name: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { can, preferences } = usePanel();
  const stream = useResource<Stream>(
    "/streams/" + encodeURIComponent(name),
    preferences.refreshInterval,
  );
  const config = useResource<PathConfig>(
    can("config.read") ? "/config/paths/" + encodeURIComponent(name) : null,
  );
  return (
    <Modal title={name} description="流详情与当前媒体状态" onClose={onClose}>
      <ErrorNotice message={stream.error} onRetry={stream.reload} />
      {!stream.data ? (
        <EmptyState loading={stream.loading} title="流详情不可用" />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <StatusBadge online={stream.data.online} />
            <span className="text-xs text-gray-400">
              {stream.data.configured ? "已配置路径" : "运行时路径"}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-5 rounded-xl bg-[#faf8f5] p-5">
            <div>
              <dt className="text-xs text-gray-400">来源类型</dt>
              <dd className="mt-2 text-sm">{stream.data.sourceType || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">读取者</dt>
              <dd className="mt-2 text-sm">{stream.data.readers}</dd>
            </div>
          </dl>
          <div>
            <h3 className="mb-3 text-sm font-medium">媒体轨道</h3>
            {stream.data.tracks?.length ? (
              <div className="flex flex-wrap gap-2">
                {stream.data.tracks.map((track, index) => (
                  <Badge key={index} className="bg-[#4a9d9a]/10 text-[#438e8b]">
                    {track.type === "video"
                      ? "视频"
                      : track.type === "audio"
                        ? "音频"
                        : "媒体"}{" "}
                    · {track.codec}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">当前没有媒体轨道</p>
            )}
          </div>
          {can("config.read") && stream.data.configured && (
            <>
              <ErrorNotice message={config.error} onRetry={config.reload} />
              {config.data && (
                <div className="rounded-xl border border-gray-100 p-4">
                  <p className="text-xs text-gray-400">
                    媒体来源
                    {config.data.sourceHasCredentials ? "（凭据已隐藏）" : ""}
                  </p>
                  <p className="mt-2 break-all text-sm text-gray-600">
                    {config.data.source || "—"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
                    <span>读取限制：{config.data.maxReaders || "不限"}</span>
                    <span>
                      录像：{config.data.record ? "已启用" : "未启用"}
                    </span>
                    <span>
                      按需拉取：{config.data.sourceOnDemand ? "是" : "否"}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-5">
            {can("connection.read") && (
              <Button asChild variant="outline">
                <Link
                  href={
                    routes.dashboardSection("connections") +
                    "?path=" +
                    encodeURIComponent(name)
                  }
                  onClick={onClose}
                >
                  查看连接
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            )}
            {can("stream.update") &&
              can("config.read") &&
              stream.data.configured && (
                <Button onClick={onEdit}>编辑配置</Button>
              )}
          </div>
        </div>
      )}
    </Modal>
  );
}
