import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  dashboardSections,
  isDashboardSection,
  type DashboardSection,
} from "@/lib/routes";
import WarmDashboard from "../dashboard-client";

type DashboardPageProps = {
  params: Promise<{ section?: string[] }>;
};

export function generateStaticParams() {
  return [
    { section: [] },
    ...dashboardSections
      .filter((section) => section !== "overview")
      .map((section) => ({ section: [section] })),
    { section: ["overview"] },
    { section: ["users"] },
    { section: ["reports"] },
  ];
}
export const dynamicParams = false;

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { section } = await params;
  const rawSection = section?.[0] ?? "overview";
  const requestedSection =
    rawSection === "users"
      ? "connections"
      : rawSection === "reports"
        ? "audit"
        : rawSection;

  // 面板只接受单层分区路径，未知或多层路径明确返回 404。
  if (
    (section && section.length !== 1) ||
    !isDashboardSection(requestedSection)
  ) {
    notFound();
  }

  const activePage: DashboardSection = requestedSection;

  return (
    <Suspense
      fallback={
        <div className="p-8 text-sm text-gray-400">正在加载工作台…</div>
      }
    >
      <WarmDashboard activePage={activePage} />
    </Suspense>
  );
}
