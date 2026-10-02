"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { OverviewSection } from "@/components/dashboard/overview-section";
import { AnalyticsSection } from "@/components/dashboard/analytics-section";
import { AuditSection } from "@/components/dashboard/audit-section";
import { ConnectionsSection } from "@/components/dashboard/connections-section";
import { StreamsSection } from "@/components/dashboard/streams-section";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { EmptyState, ErrorNotice } from "@/components/dashboard/panel-ui";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/components/panel-provider";
import { useResource } from "@/lib/use-resource";
import {
  routes,
  sectionPermissions,
  type DashboardSection,
} from "@/lib/routes";
import type { Dashboard } from "@/lib/types";

const metadata: Record<DashboardSection, { title: string; subtitle: string }> =
  {
    overview: { title: "仪表盘概览", subtitle: "每一路流与连接，尽在掌握" },
    streams: { title: "流管理", subtitle: "配置媒体来源，查看实时流状态" },
    connections: { title: "连接管理", subtitle: "查看与管理各协议的媒体会话" },
    analytics: { title: "数据分析", subtitle: "观察码率、媒体流量与采样状态" },
    audit: { title: "审计日志", subtitle: "每一次操作，都有迹可循" },
    settings: { title: "系统设置", subtitle: "管理路径配置与工作台偏好" },
  };

export default function DashboardClient({
  activePage,
}: {
  activePage: DashboardSection;
}) {
  const router = useRouter();
  const {
    session,
    sessionLoading,
    sessionError,
    reloadSession,
    can,
    preferences,
    recordTraffic,
  } = usePanel();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    setSidebarOpen(window.matchMedia("(min-width: 1024px)").matches);
  }, []);
  useEffect(() => {
    if (!sessionLoading && !session && !sessionError)
      router.replace(routes.login);
  }, [session, sessionLoading, sessionError, router]);
  const dashboard = useResource<Dashboard>(
    session ? "/dashboard" : null,
    preferences.refreshInterval,
  );
  useEffect(() => {
    if (dashboard.data)
      recordTraffic(
        dashboard.error
          ? { ...dashboard.data.traffic, stale: true }
          : dashboard.data.traffic,
      );
  }, [dashboard.data, dashboard.error, recordTraffic]);
  if (sessionLoading || !session)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#faf8f5] p-6">
        <Card className="w-full max-w-md p-6">
          <ErrorNotice message={sessionError} onRetry={reloadSession} />
          <EmptyState
            loading={sessionLoading}
            title={sessionError ? "暂时无法恢复会话" : "正在前往登录页…"}
          />
        </Card>
      </main>
    );
  const allowed = can(sectionPermissions[activePage]);
  const page = metadata[activePage];
  function closeOnMobile() {
    if (!window.matchMedia("(min-width: 1024px)").matches)
      setSidebarOpen(false);
  }
  return (
    <div className="min-h-screen bg-[#faf8f5] text-gray-800">
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-40 bg-gray-900/20 backdrop-blur-[2px] lg:hidden"
          aria-label="关闭侧边栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <DashboardSidebar
        activePage={activePage}
        open={sidebarOpen}
        onNavigate={closeOnMobile}
      />
      <div
        className={
          "min-w-0 transition-all duration-300 " +
          (sidebarOpen ? "lg:ml-60" : "")
        }
      >
        <DashboardHeader
          title={page.title}
          subtitle={page.subtitle}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          dashboard={dashboard.data}
          error={dashboard.error}
          loading={dashboard.loading}
        />
        <main className="mx-auto max-w-[1600px] p-4 md:p-8">
          {!allowed ? (
            <Card className="p-8 text-center">
              <LockKeyhole className="mx-auto mb-4 h-8 w-8 text-[#6b8e8e]" />
              <h2 className="text-lg font-semibold">您没有访问此页面的权限</h2>
              <p className="mt-2 text-sm text-gray-400">
                请联系管理员调整账号权限。
              </p>
              <Button
                className="mt-5"
                onClick={() => router.push(routes.dashboard)}
              >
                返回概览
              </Button>
            </Card>
          ) : (
            <>
              {activePage === "overview" && (
                <OverviewSection
                  dashboard={dashboard.data}
                  loading={dashboard.loading}
                  error={dashboard.error}
                  reload={dashboard.reload}
                />
              )}
              {activePage === "streams" && <StreamsSection />}
              {activePage === "connections" && <ConnectionsSection />}
              {activePage === "analytics" && <AnalyticsSection />}
              {activePage === "audit" && <AuditSection />}
              {activePage === "settings" && (
              <SettingsSection instance={dashboard.error ? undefined : dashboard.data?.instance} />
              )}
            </>
          )}
          <footer className="mt-8 flex flex-wrap justify-between gap-2 text-[11px] text-gray-400">
            <span>MediaMTX Panel</span>
            <span>
              {preferences.refreshInterval
                ? "每 " + preferences.refreshInterval / 1000 + " 秒自动刷新"
                : "手动刷新"}{" "}
              · 页面隐藏时暂停刷新
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
