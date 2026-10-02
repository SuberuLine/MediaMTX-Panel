import type { Metadata } from "next";
import "./globals.css";
import { PanelProvider } from "@/components/panel-provider";

export const metadata: Metadata = {
  title: {
    default: "MediaMTX Panel",
    template: "%s · MediaMTX Panel",
  },
  description: "MediaMTX 流媒体服务管理面板。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <PanelProvider>{children}</PanelProvider>
      </body>
    </html>
  );
}
