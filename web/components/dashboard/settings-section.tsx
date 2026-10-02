"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  SlidersHorizontal,
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
import { formatDate, formatUptime, roleLabels } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Instance, PathConfig } from "@/lib/types";
import {
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  Pagination,
  StatusBadge,
  selectClassName,
} from "./panel-ui";
import { PathEditor } from "./path-editor";

export function SettingsSection({ instance }: { instance?: Instance }) {
  const { session, preferences, savePreferences, toast, can } = usePanel();
  const [interval, setInterval] = useState(preferences.refreshInterval);
  const [size, setSize] = useState(preferences.pageSize);
  useEffect(() => {
    setInterval(preferences.refreshInterval);
    setSize(preferences.pageSize);
  }, [preferences]);
  function save(event: FormEvent) {
    event.preventDefault();
    const saved = savePreferences({
      refreshInterval: interval,
      pageSize: size,
    });
    toast(saved ? "工作台偏好已保存" : "偏好已应用，浏览器未允许持久保存");
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-[#4a9d9a]" />
            <h2 className="text-lg font-semibold">当前账号</h2>
          </div>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-400">用户名</dt>
              <dd className="break-all font-medium">
                {session?.user.username}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">角色</dt>
              <dd>
                <Badge className="bg-[#e8b86d]/15 text-[#9b7840]">
                  {roleLabels[session?.user.role ?? ""]}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-gray-400">会话到期</dt>
              <dd className="text-xs text-gray-600">
                {formatDate(session?.expiresAt)}
              </dd>
            </div>
          </dl>
          <p className="mt-5 border-t border-gray-100 pt-4 text-xs leading-6 text-gray-400">
            可见功能与可执行操作由账号权限决定。
          </p>
        </Card>
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <Server className="h-5 w-5 text-[#6b8e8e]" />
            <h2 className="text-lg font-semibold">实例信息</h2>
          </div>
          <dl className="space-y-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-400">连接状态</dt>
              <dd>
                {instance ? (
                  <StatusBadge online={instance.online} />
                ) : (
                  "暂不可用"
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">MediaMTX 版本</dt>
              <dd>{instance?.version || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">运行时长</dt>
              <dd>{instance ? formatUptime(instance.uptime) : "—"}</dd>
            </div>
          </dl>
        </Card>
      </div>
      <Card className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <SlidersHorizontal className="h-5 w-5 text-[#4a9d9a]" />
          <div>
            <h2 className="text-lg font-semibold">工作台偏好</h2>
            <p className="mt-1 text-xs text-gray-400">
              为当前浏览器保存您的使用习惯
            </p>
          </div>
        </div>
        <form onSubmit={save}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="refresh-interval"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                自动刷新
              </label>
              <select
                id="refresh-interval"
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
                className={selectClassName + " w-full"}
              >
                <option value={5000}>每 5 秒</option>
                <option value={10000}>每 10 秒</option>
                <option value={30000}>每 30 秒</option>
                <option value={0}>关闭，手动刷新</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="page-size"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                每页条数
              </label>
              <select
                id="page-size"
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
                className={selectClassName + " w-full"}
              >
                {[20, 50, 100].map((value) => (
                  <option value={value} key={value}>
                    {value} 条
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex justify-end border-t border-gray-100 pt-5">
            <Button
              type="submit"
              disabled={
                interval === preferences.refreshInterval &&
                size === preferences.pageSize
              }
            >
              保存偏好
            </Button>
          </div>
        </form>
      </Card>
      {can("config.read") && <PathSettings />}
    </div>
  );
}

function PathSettings() {
  const { can, preferences, toast, refresh } = usePanel();
  const resource = useResource<PathConfig[]>(
    "/config/paths",
    preferences.refreshInterval,
    true,
  );
  const [editor, setEditor] = useState<{ name: string | null } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const paths =
    resource.data?.filter((path) =>
      path.name.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(paths.length / preferences.pageSize)),
  );
  const visible = paths.slice(
    (currentPage - 1) * preferences.pageSize,
    currentPage * preferences.pageSize,
  );
  return (
    <Card className="p-5 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">路径配置</h2>
          <p className="mt-1 text-xs text-gray-400">
            管理当前实例中的已配置路径
          </p>
        </div>
        {can("config.update") && (
          <Button onClick={() => setEditor({ name: null })}>
            <Plus className="h-4 w-4" />
            新建路径
          </Button>
        )}
      </div>
      <ErrorNotice message={resource.error} onRetry={resource.reload} />
      <Input
        aria-label="搜索路径配置"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        placeholder="搜索路径名称…"
        className="mb-4 max-w-sm"
      />
      {!resource.data ? (
        <EmptyState loading={resource.loading} title="未能加载路径配置" />
      ) : !paths.length ? (
        <EmptyState title="暂无匹配路径配置" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>路径</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>读取限制</TableHead>
              <TableHead>录像</TableHead>
              {can("config.update") && <TableHead>操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((path) => (
              <TableRow key={path.name} className="hover:bg-[#faf8f5]">
                <TableCell className="max-w-48 break-all text-sm font-medium text-gray-700">
                  {path.name}
                </TableCell>
                <TableCell>
                  <p className="max-w-sm break-all text-xs text-gray-500">
                    {path.source || "—"}
                  </p>
                  {path.sourceHasCredentials && (
                    <p className="mt-1 text-[10px] text-[#9b7840]">
                      凭据已隐藏
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-gray-500">
                  {path.maxReaders || "不限"}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      path.record
                        ? "bg-[#4a9d9a]/10 text-[#438e8b]"
                        : "bg-gray-100 text-gray-400"
                    }
                  >
                    {path.record ? path.recordFormat.toUpperCase() : "关闭"}
                  </Badge>
                </TableCell>
                {can("config.update") && (
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={"编辑配置 " + path.name}
                        onClick={() => setEditor({ name: path.name })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={"删除配置 " + path.name}
                        onClick={() => setDeleting(path.name)}
                        className="text-[#c17767]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
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
          total={paths.length}
          onChange={setPage}
        />
      )}
      {editor && (
        <PathEditor
          name={editor.name}
          endpoint="/config/paths"
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={"删除路径 " + deleting}
          description="删除此配置可能中断媒体发布与读取，且无法撤销。"
          label="删除路径"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await apiRequest("/config/paths/" + encodeURIComponent(deleting), {
              method: "DELETE",
            });
            setDeleting(null);
            toast("路径配置已删除");
            refresh();
          }}
        />
      )}
    </Card>
  );
}
