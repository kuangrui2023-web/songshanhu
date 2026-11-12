"use client";
import { useEffect } from "react";
import { sitePath } from "@/lib/site-path";

export default function MapPage() {
  const destination = sitePath("/experience/");
  useEffect(() => { window.location.replace(destination); }, [destination]);
  return <main><p>地图找房已取消。</p><a href={destination}>返回房源列表</a></main>;
}
