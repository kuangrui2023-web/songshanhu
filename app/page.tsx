"use client";

import { useEffect } from "react";
import { sitePath } from "@/lib/site-path";

export default function Home() {
  const destination = sitePath("/experience/");
  useEffect(() => { window.location.replace(destination + window.location.search); }, [destination]);
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#1677ff" }}>
    <a href={destination}>正在打开松山湖产业招商网站…</a>
  </main>;
}
