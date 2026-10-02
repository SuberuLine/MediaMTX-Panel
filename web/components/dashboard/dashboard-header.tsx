"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Menu,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { usePanel } from "@/components/panel-provider";
import { routes } from "@/lib/routes";
import type { Dashboard } from "@/lib/types";

export function DashboardHeader({
  title,
  subtitle,
  sidebarOpen,
  onToggleSidebar,
  dashboard,
  error,
  loading,
}: {
  title: string;
  subtitle: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  dashboard?: Dashboard;
  error: string | null;
  loading: boolean;
}) {
  const router = useRouter();
  const { session, refresh, preferences } = usePanel();
  const [search, setSearch] = useState("");
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alerts: string[] = [];
  if (error) alerts.push(error);
  if (dashboard?.traffic.stale)
    alerts.push("指标采样已过期，码率暂不可用。请检查指标服务连接。");
  if (dashboard?.connections.unavailableProtocols?.length)
    alerts.push(
      "部分协议未启用：" +
        dashboard.connections.unavailableProtocols
          .map((protocol) => protocol.toUpperCase())
          .join("、"),
    );
  function find(event: FormEvent) {
    event.preventDefault();
    router.push(
      routes.dashboardSection("streams") +
        "?q=" +
        encodeURIComponent(search.trim()),
    );
  }
  return (
    <header className="sticky top-0 z-30 border-b border-gray-200/50 bg-[#faf8f5]/90 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 px-4 py-4 md:px-8">
        <div className="flex min-w-0 items-center gap-3 md:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          >
            <Menu className="h-5 w-5 text-gray-500" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-gray-800 md:text-xl">
              {title}
            </h1>
            <p className="mt-0.5 hidden text-xs text-gray-400 sm:block">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <form onSubmit={find} className="relative hidden lg:block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索流路径…"
              aria-label="全局搜索流路径"
              className="w-48 bg-white pl-10 xl:w-60"
            />
          </form>
          <span
            className={
              "hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] sm:flex " +
              (error
                ? "bg-[#c17767]/10 text-[#a45c4e]"
                : "bg-[#4a9d9a]/10 text-[#438e8b]")
            }
          >
            <span
              className={
                "h-1.5 w-1.5 rounded-full " +
                (error
                  ? "bg-[#c17767]"
                  : dashboard
                    ? "bg-[#4a9d9a]"
                    : "bg-gray-400")
              }
            />
            {error ? "状态待更新" : dashboard ? "实例在线" : "连接中"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="bg-white shadow-lg shadow-black/5"
            aria-label="刷新数据"
            title={
              preferences.refreshInterval
                ? "自动刷新中 · 点击立即刷新"
                : "手动刷新"
            }
            onClick={refresh}
          >
            <RefreshCw
              className={
                "h-4 w-4 text-gray-500 " + (loading ? "animate-spin" : "")
              }
            />
          </Button>
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              className="relative bg-white shadow-lg shadow-black/5"
              aria-label="运行提示"
              aria-expanded={alertsOpen}
              onClick={() => setAlertsOpen(!alertsOpen)}
            >
              <Bell className="h-[18px] w-[18px] text-gray-600" />
              {alerts.length > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#e8b86d]" />
              )}
            </Button>
            {alertsOpen && (
              <>
                <button
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="关闭运行提示"
                  onClick={() => setAlertsOpen(false)}
                />
                <Card className="absolute right-0 top-full z-50 mt-3 w-72 max-w-[calc(100vw-2rem)] overflow-hidden border border-gray-100 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
                    <span className="text-sm font-semibold">运行提示</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      aria-label="收起运行提示"
                      onClick={() => setAlertsOpen(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-4 p-5">
                    {alerts.length ? (
                      alerts.map((message) => (
                        <div key={message} className="flex gap-3">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#e8b86d]" />
                          <p className="text-xs leading-6 text-gray-500">
                            {message}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-[#4a9d9a]" />
                        <p className="text-sm text-gray-500">
                          {dashboard ? "当前没有运行提示" : "等待服务状态更新"}
                        </p>
                      </div>
                    )}
                  </div>
                </Card>
              </>
            )}
          </div>
          <Avatar className="hidden sm:flex">
            <AvatarFallback className="bg-[#e8b86d]">
              {session?.user.username.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
