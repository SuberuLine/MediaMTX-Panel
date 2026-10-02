export const dashboardSections = [
  "overview",
  "analytics",
  "streams",
  "connections",
  "audit",
  "settings",
] as const;

export type DashboardSection = (typeof dashboardSections)[number];

export const sectionPermissions: Record<DashboardSection, string> = {
  overview: "dashboard.read",
  streams: "stream.read",
  connections: "connection.read",
  analytics: "metrics.read",
  audit: "audit.read",
  settings: "dashboard.read",
};

export const routes = {
  login: "/login",
  dashboard: "/dashboard",
  dashboardSection: (section: DashboardSection) =>
    section === "overview" ? "/dashboard" : `/dashboard/${section}`,
} as const;

/**
 * 仅允许产品定义过的面板路由，避免任意路径进入客户端导航逻辑。
 */
export function isDashboardSection(value: string): value is DashboardSection {
  return dashboardSections.some((section) => section === value);
}
