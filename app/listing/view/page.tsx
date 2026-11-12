"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { getPublished, PublicListing } from "@/lib/backend";
import { InquiryDialog } from "@/components/InquiryDialog";
import { MobileNavigation, SiteHeader } from "@/components/SiteNavigation";
import { sitePath } from "@/lib/site-path";

export default function LiveDetail() {
  const [item, setItem] = useState<PublicListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [inquiryOpen, setInquiryOpen] = useState(false);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (!id) { setLoading(false); return; }
    getPublished(id).then(setItem).catch(() => {}).finally(() => setLoading(false));
  }, []);
  const show = (value: string | number | null) => value === null || value === "" ? "待补充" : value;
  return <div className="site-shell"><SiteHeader/><main className="detail-main"><a href={sitePath("/#listings")} className="back-link"><ChevronLeft size={18}/>返回房源列表</a>{loading ? <p>正在加载房源…</p> : !item ? <p>这条房源暂未发布或已经下架。</p> : <div className="detail-layout"><div><div className="detail-image">{item.images[0] && <img src={item.images[0]} alt={`${item.title}实拍照片`}/>}</div>{item.images.length > 1 && <div className="detail-gallery">{item.images.slice(1).map((src,i)=><img key={src} src={src} alt={`${item.title}实拍照片 ${i+2}`}/>)}</div>}{item.videos.length > 0 && <div className="detail-videos">{item.videos.map(src=><video key={src} src={src} controls playsInline/>)}</div>}<section className="detail-section"><h2>房源信息</h2><div className="facts"><div><span>业态</span><strong>{item.category}</strong></div><div><span>所属片区</span><strong>{item.region||"待确认"}</strong></div><div><span>楼层</span><strong>{show(item.floor)}</strong></div><div><span>面积</span><strong>{item.area === null ? "待补充" : `${item.area}㎡`}</strong></div><div><span>装修</span><strong>{show(item.decoration)}</strong></div><div><span>朝向</span><strong>{show(item.facing)}</strong></div><div><span>格局</span><strong>{show(item.layout)}</strong></div></div>{item.description && <p className="detail-description">{item.description}</p>}</section></div><aside className="detail-summary"><span className="eyebrow">已上架 · {item.category}</span><h1>{item.title}</h1>{item.listing_code&&<p className="workspace-listing-code">房源编号：{item.listing_code}</p>}<div className="detail-price">{item.price === null ? <strong className="price-pending">租金面议</strong> : <><strong>¥{item.price}</strong><span> /㎡·月</span></>}</div><p>{item.fee === null ? "物业费待补充" : `物业费 ¥${item.fee}/㎡·月`}</p><button className="primary-action" onClick={()=>setInquiryOpen(true)}>咨询 / 预约看房</button><div className="detail-alert">房源资料由管理员发布，具体在租状态与价格请以实际沟通为准。</div></aside></div>}</main><footer>松山湖产业招商</footer><MobileNavigation active="listings"/><InquiryDialog open={inquiryOpen} onOpenChange={setInquiryOpen} listingId={item?.id}/></div>;
}
