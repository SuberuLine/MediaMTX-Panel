"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  Cable,
  ChevronRight,
  Home,
  LogOut,
  Radio,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/components/panel-provider";
import { errorMessage } from "@/lib/api";
import { roleLabels } from "@/lib/format";
import {
  routes,
  sectionPermissions,
  type DashboardSection,
} from "@/lib/routes";

const items = [
  { icon: Home, label: "概览", id: "overview" },
  { icon: Radio, label: "流管理", id: "streams" },
  { icon: Cable, label: "连接管理", id: "connections" },
  { icon: Activity, label: "数据分析", id: "analytics" },
  { icon: ShieldCheck, label: "审计日志", id: "audit" },
  { icon: Settings, label: "设置", id: "settings" },
] as const;

export function DashboardSidebar({
  activePage,
  open,
  onNavigate,
}: {
  activePage: DashboardSection;
  open: boolean;
  onNavigate: () => void;
}) {
  const { session, can, logout } = usePanel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function leave() {
    setBusy(true);
    setError(null);
    try {
      await logout();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside
      inert={!open}
      aria-label="主导航"
      className={
        "fixed left-0 top-0 z-50 h-dvh w-60 border-r border-gray-200/60 bg-[#faf8f5] transition-transform duration-300 " +
        (open ? "translate-x-0" : "-translate-x-full")
      }
    >
      <div className="flex h-full flex-col overflow-y-auto p-6">
        <Link
          href={routes.dashboard}
          onClick={onNavigate}
          className="mb-10 flex items-center gap-3"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#4a9d9a]">
            <Radio className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="whitespace-nowrap text-lg font-semibold text-gray-800">
              MediaMTX
            </span>
            <p className="text-[10px] tracking-[0.2em] text-gray-400">
              CONTROL PANEL
            </p>
          </div>
        </Link>
        <nav className="flex-1 space-y-1">
          {items
            .filter((item) => can(sectionPermissions[item.id]))
            .map((item) => {
              const active = activePage === item.id;
              return (
                <Button
                  key={item.id}
                  asChild
                  variant="ghost"
                  className={
                    "h-auto w-full justify-start gap-3 px-4 py-3 " +
                    (active
                      ? "bg-[#4a9d9a] text-white shadow-lg shadow-[#4a9d9a]/25 hover:bg-[#4a9d9a] hover:text-white"
                      : "hover:shadow-sm")
                  }
                >
                  <Link
                    href={routes.dashboardSection(item.id)}
                    prefetch={false}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    <span className="whitespace-nowrap font-medium">
                      {item.label}
                    </span>
                    {active && (
                      <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60" />
                    )}
                  </Link>
                </Button>
              );
            })}
        </nav>
        <div className="mt-6 border-t border-gray-100 pt-6">
          {error && (
            <p role="alert" className="mb-3 text-xs leading-5 text-[#a45c4e]">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[#e8b86d]">
                {session?.user.username.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-gray-700">
                {session?.user.username}
              </div>
              <div className="mt-0.5 text-xs text-gray-400">
                {roleLabels[session?.user.role ?? ""]}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={leave}
              disabled={busy}
              className="ml-auto h-8 w-8 rounded-lg text-gray-400 hover:text-[#c17767]"
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
