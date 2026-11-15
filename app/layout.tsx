import type { Metadata } from "next";
import "./globals.css";
import { sitePath } from "@/lib/site-path";

export const metadata: Metadata = {
  title: "松山湖产业招商｜企业空间与产业资源",
  description: "浏览松山湖周边写字楼、厂房等产业空间，按需求筛选房源，了解产业资源与企业合作服务。",
  icons: {
    icon: [
      { url: sitePath("/favicon.svg?v=20261115a"), type: "image/svg+xml" },
      { url: sitePath("/favicon-180.png?v=20261115a"), sizes: "180x180", type: "image/png" },
    ],
    shortcut: sitePath("/favicon.svg?v=20261115a"),
    apple: sitePath("/favicon-180.png?v=20261115a"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}<script src={sitePath("/interaction-core.js?v=20261016e")} defer /></body>
    </html>
  );
}
