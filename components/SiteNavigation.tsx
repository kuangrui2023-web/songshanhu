import { Building2, Home, Search, UserRound } from "lucide-react";
import { sitePath } from "@/lib/site-path";

export function SiteHeader() {
  return <header className="site-header">
    <a className="brand" href={sitePath("/")}><span className="brand-mark"><Building2 size={23}/></span><strong>松山湖产业招商</strong></a>
    <nav aria-label="主导航"><a href={sitePath("/#listings")}>找房源</a><a href={sitePath("/industry")}>产业资源</a><a href={sitePath("/me")}>我的</a></nav>
    <span className="review-badge">登来</span>
  </header>;
}

export function MobileNavigation({ active }: { active: "home" | "listings" | "me" }) {
  return <nav className="mobile-nav" aria-label="移动端导航">
    <a className={active === "home" ? "selected" : ""} href={sitePath("/")}><Home size={21}/>首页</a>
    <a className={active === "listings" ? "selected" : ""} href={sitePath("/#listings")}><Search size={21}/>房源</a>
    <a className={active === "me" ? "selected" : ""} href={sitePath("/me")}><UserRound size={21}/>我的</a>
  </nav>;
}
