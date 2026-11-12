import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import data from "@/data/listings.json";
import { MobileNavigation, SiteHeader } from "@/components/SiteNavigation";
import { sitePath } from "@/lib/site-path";

export function generateStaticParams() {
  return data.map(item => ({ id: item.id }));
}

export default async function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = data.find(x => x.id === id);
  if (!item) notFound();
  const real = item.source === "用户提供实拍";
  const title = item.unit;
  const display = (value: string | number | null) => value === null || value === "" || value === "-" ? "待补充" : value;

  return <div className="site-shell">
    <SiteHeader/>
    <main className="detail-main">
      <a href={sitePath("/")} className="back-link"><ChevronLeft size={18}/>返回房源列表</a>
      <div className="detail-layout">
        <div>
          <div className="detail-image"><img src={sitePath(item.image)} alt={real ? `${title}实拍照片` : `${title}示意图`}/></div>
          <div className="detail-note">{real ? "用户提供的房源实拍照片。园区、面积、租金等资料尚待补充。" : "此图为项目原有占位素材，并非该房源实拍。"}</div>
          <section className="detail-section"><h2>房源信息</h2><div className="facts">
            <div><span>业态</span><strong>{display(item.category)}</strong></div>
            <div><span>房号</span><strong>{real ? "待补充" : display(item.unit)}</strong></div>
            <div><span>楼层</span><strong>{display(item.floor)}</strong></div>
            <div><span>面积</span><strong>待补充</strong></div>
            <div><span>装修</span><strong>{display(item.decoration)}</strong></div>
            <div><span>朝向</span><strong>{display(item.facing)}</strong></div>
            <div><span>格局</span><strong>{display(item.layout)}</strong></div>
          </div></section>
        </div>
        <aside className="detail-summary"><span className="eyebrow">实拍资料 · {item.category}</span><h1>{title}</h1><p>该房源尚未核实位置、面积和价格，暂不作为在租房源展示。</p><div className="detail-price"><strong className="price-pending">资料待补充</strong></div><div className="detail-alert">照片来自用户，四张照片分别属于不同房源。管理员补充并核实资料后再上架。</div></aside>
      </div>
    </main>
    <footer>松山湖产业招商 · 网站评审版</footer>
    <MobileNavigation active="listings"/>
  </div>;
}
