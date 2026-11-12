import { ArrowRight, Bookmark, Building2, CalendarDays, LockKeyhole, MessageSquare, UserRound } from "lucide-react";
import { MobileNavigation, SiteHeader } from "@/components/SiteNavigation";
import { sitePath } from "@/lib/site-path";

const entries = [
  { icon: Bookmark, title: "我的收藏", text: "保存感兴趣的房源", state: "会员功能待开通" },
  { icon: CalendarDays, title: "看房预约", text: "查看预约和跟进记录", state: "后台接入后开放" },
  { icon: Building2, title: "企业简介", text: "提交企业资料供审核", state: "会员功能待开通" },
  { icon: MessageSquare, title: "我的供需", text: "管理合作、采购与供应需求", state: "会员功能待开通" },
];

export default function MePage() {
  return <div className="site-shell"><SiteHeader/><main className="feature-main"><div className="feature-heading"><span className="eyebrow">个人中心</span><h1>我的产业空间</h1><p>集中管理收藏、看房预约及企业供需资料。</p></div><div className="profile-card"><span className="profile-avatar"><UserRound size={31}/></span><div><h2>访客模式</h2><p>会员手机号核验和云端账户服务尚未接入。</p></div><span className="profile-state"><LockKeyhole size={15}/>未登录</span></div><div className="section-title"><h2>我的服务</h2><span>按需求文档规划</span></div><div className="profile-grid">{entries.map(({icon: Icon,title,text,state})=><div className="profile-entry" key={title}><Icon size={22}/><div><strong>{title}</strong><p>{text}</p><small>{state}</small></div></div>)}</div><div className="profile-tip"><strong>先浏览房源</strong><p>房源列表和详情无需登录即可查看。详细位置请联系招商顾问了解。</p><a href={sitePath("/#listings")}>浏览房源 <ArrowRight size={16}/></a></div></main><footer>松山湖产业招商</footer><MobileNavigation active="me"/></div>;
}
