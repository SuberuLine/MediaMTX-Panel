"use client";

import { useEffect, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
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
import { actionLabels, downloadCsv, formatDate } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import type { Audit } from "@/lib/types";
import { EmptyState, ErrorNotice, Pagination } from "./panel-ui";

export function AuditOutcome({ outcome }: { outcome: string }) {
  return (
    <Badge
      className={
        outcome === "success"
          ? "bg-[#4a9d9a]/10 text-[#438e8b]"
          : outcome === "pending"
            ? "bg-[#e8b86d]/15 text-[#9b7840]"
            : "bg-[#c17767]/10 text-[#a45c4e]"
      }
    >
      {outcome === "success"
        ? "成功"
        : outcome === "pending"
          ? "待确认"
          : outcome === "failure"
            ? "失败"
            : outcome}
    </Badge>
  );
}
export function AuditSection() {
  const { preferences } = usePanel();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [preferences.pageSize]);
  const resource = useResource<Audit[]>(
    "/audit-logs?page=" + page + "&pageSize=" + preferences.pageSize,
    preferences.refreshInterval,
  );
  const total = resource.pagination?.total ?? 0;
  function exportPage() {
    if (!resource.data) return;
    downloadCsv("mediamtx-audit-page-" + page + ".csv", [
      ["时间", "用户", "操作", "资源", "IP", "结果"],
      ...resource.data.map((audit) => [
        audit.time,
        audit.user,
        actionLabels[audit.action] ?? audit.action,
        audit.resource,
        audit.ip,
        audit.outcome,
      ]),
    ]);
  }
  return (
    <>
      <ErrorNotice message={resource.error} onRetry={resource.reload} />
      <Card className="p-5 md:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4a9d9a]/10">
              <ShieldCheck className="h-5 w-5 text-[#4a9d9a]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">操作审计</h2>
              <p className="mt-1 text-xs text-gray-400">
                追溯登录、配置修改与连接操作
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={exportPage}
            disabled={!resource.data?.length || Boolean(resource.error)}
          >
            <Download className="h-4 w-4" />
            导出当前页
          </Button>
        </div>
        {!resource.data ? (
          <EmptyState loading={resource.loading} title="未能加载审计记录" />
        ) : !resource.data.length ? (
          <EmptyState
            title="暂无审计记录"
            description="面板操作会自动记录在这里。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>资源</TableHead>
                <TableHead>来源 IP</TableHead>
                <TableHead>结果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resource.data.map((audit) => (
                <TableRow key={audit.id} className="hover:bg-[#faf8f5]">
                  <TableCell className="whitespace-nowrap text-xs text-gray-500">
                    {formatDate(audit.time)}
                  </TableCell>
                  <TableCell className="text-sm font-medium text-gray-700">
                    {audit.user}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-gray-600">
                    {actionLabels[audit.action] ?? audit.action}
                  </TableCell>
                  <TableCell className="max-w-64 break-all text-xs text-gray-500">
                    {audit.resource || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-gray-500">
                    {audit.ip || "—"}
                  </TableCell>
                  <TableCell>
                    <AuditOutcome outcome={audit.outcome} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {resource.pagination && (
          <Pagination
            page={page}
            pageSize={preferences.pageSize}
            total={total}
            onChange={setPage}
          />
        )}
        <p className="mt-4 rounded-xl bg-[#faf8f5] px-4 py-3 text-xs leading-6 text-gray-400">
          “待确认”表示操作意图已记录，但最终结果尚未写入。请结合实例的实际状态确认是否生效。
        </p>
      </Card>
    </>
  );
}
