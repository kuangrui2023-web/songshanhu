import { ArrowRight, BadgeCheck, BriefcaseBusiness, ClipboardList, LockKeyhole, Network } from "lucide-react";
import { MobileNavigation, SiteHeader } from "@/components/SiteNavigation";
import { sitePath } from "@/lib/site-path";

const types = [
  { title: "产品供应", detail: "展示企业可提供的产品与产能" },
  { title: "原料采购", detail: "汇集企业采购需求与合作条件" },
  { title: "项目合作", detail: "寻找研发、制造与落地合作伙伴" },
  { title: "投融资对接", detail: "连接项目与合适的资金资源" },
  { title: "产业服务", detail: "法律、财税、技术与运营服务" },
];

export default function IndustryPage() {
  return <div className="site-shell"><SiteHeader/><main className="feature-main"><div className="feature-heading"><span className="eyebrow">产业资源</span><h1>让企业需求找到合作方</h1><p>企业简介与供需需求经管理员审核后进入资源池，房源信息与产业资源独立管理。</p></div>
    <div className="industry-overview"><div className="industry-intro"><Network size={34}/><h2>产业链供需对接</h2><p>围绕企业主营业务、供应能力与采购需求建立企业画像，逐步开放产业链匹配。</p><div className="industry-flow"><span><ClipboardList size={17}/>提交资料</span><ArrowRight size={15}/><span><BadgeCheck size={17}/>人工审核</span><ArrowRight size={15}/><span><BriefcaseBusiness size={17}/>资源匹配</span></div></div><div className="industry-locked"><LockKeyhole size={23}/><strong>资源池仅会员可见</strong><p>当前网站尚未接通会员身份核验，因此不展示企业信息、需求或联系方式。</p><a href={sitePath("/me")}>了解会员功能 <ArrowRight size={16}/></a></div></div>
    <div className="section-title"><h2>需求类型</h2><span>资料审核通过后才会展示</span></div><div className="industry-types">{types.map((type,index)=><div key={type.title}><span>{String(index+1).padStart(2,"0")}</span><strong>{type.title}</strong><p>{type.detail}</p></div>)}</div>
  </main><footer>松山湖产业招商 · 产业资源</footer><MobileNavigation active="me"/></div>;
}
