import type { Metadata } from "next";
import "./globals.css";
import { sitePath } from "@/lib/site-path";

export const metadata: Metadata = {
  title: "松山湖产业空间｜园区房源与产业资源",
  description: "浏览松山湖园区写字楼、厂房等产业空间与入驻企业，按需求筛选房源，了解产业资源与招商服务。",
  icons: {
    icon: [
      { url: sitePath("/favicon.svg?v=20261116a"), type: "image/svg+xml" },
      { url: sitePath("/favicon-180.png?v=20261116a"), sizes: "180x180", type: "image/png" },
    ],
    shortcut: sitePath("/favicon.svg?v=20261116a"),
    apple: sitePath("/favicon-180.png?v=20261116a"),
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
