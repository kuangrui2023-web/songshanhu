'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Building2, ClipboardList, X } from 'lucide-react';
import type { LiveListing } from '@/lib/backend';
import type { Park } from '@/lib/admin-workspace';
import { visibleField, isIndustrial, publicListingPreview, type VisibilityKey } from '@/lib/listing-editor';
import { calculateFees, amount } from '@/lib/fees';
import { ListingOutline } from '@/components/listing-outline';
import { RegionSelector } from '@/components/region-selector';

type Change = <K extends keyof LiveListing>(key:K,value:LiveListing[K])=>void;
type Props={listing:LiveListing;onChange:Change;onPark:(name:string)=>void;parks:Park[];assignedPark:string|null;parkOnly:boolean;errors:Record<string,string>;children:ReactNode};
export const technicalFields=[['compatible_industries','适配行业'],['factory_height','层高'],['factory_load','承重'],['factory_power','配电'],['fire_rating','消防'],['environmental_requirements','环评'],['has_crane_support','行车支撑（牛角）'],['freight_elevator_load','货梯载重'],['freight_elevator_size','货梯尺寸'],['has_passenger_elevator','客梯'],['has_water','上下水']] as const;
const privateKeys=new Set(['park','building','room','owner_floor_price','owner_contact_name','owner_contact_phone','channel_notes','followup_notes','address','longitude','latitude']);
function Section({id,title,description,children,optional=false}:{id:string;title:string;description:string;children:ReactNode;optional?:boolean}){
  return <section className="listing-section" id={`listing-section-${id}`}><div className="listing-section-heading"><div><h3>{title}</h3><p>{description}</p></div>{optional&&<span>选填</span>}</div><div className="listing-section-body"><div className="listing-field-grid">{children}</div></div></section>;
}
export function ListingFields({listing:l,onChange:change,onPark,parks,assignedPark,parkOnly,errors,children}:Props){
  const industrial=isIndustrial(l.category),fees=calculateFees(l.area,l.price,l.fee);
  const scope=(key:VisibilityKey)=> <button className={`listing-scope ${visibleField(l,key)?'public':'private'}`} type="button" aria-label={`${{park:'园区',building:'楼栋',floor:'楼层',room:'房号',address:'地址',coordinates:'地图定位',has_agent_fee:'中介费',wechat:'微信',video_channel:'视频号'}[key]}：${visibleField(l,key)?'公开展示，点击改为仅后台':'仅后台，点击改为公开展示'}`} aria-pressed={visibleField(l,key)} onClick={()=>change('field_visibility',{...l.field_visibility,[key]:!visibleField(l,key)})}>{visibleField(l,key)?'公开展示':'仅后台'}<span aria-hidden="true">⌄</span></button>;
  const field=(key:keyof LiveListing,label:string,content:ReactNode,options:{wide?:boolean;scope?:VisibilityKey;hint?:string;required?:boolean}={})=><div className={`listing-field ${options.wide?'wide':''}`} key={key}><div className="listing-label-line"><label htmlFor={`listing-${key}`}>{label}{options.required&&<span className="listing-required">*</span>}</label>{options.scope?scope(options.scope):privateKeys.has(key)?<span className="listing-scope private">仅后台</span>:null}</div>{content}{options.hint&&<small>{options.hint}</small>}{errors[key]&&<span className="admin-field-error" id={`listing-${key}-error`}>{errors[key]}</span>}</div>;
  const attrs=(key:keyof LiveListing)=>({id:`listing-${key}`,'aria-invalid':Boolean(errors[key]),'aria-describedby':errors[key]?`listing-${key}-error`:undefined});
  const text=(key:keyof LiveListing,label:string,placeholder:string,options:Parameters<typeof field>[3]={})=>field(key,label,<input {...attrs(key)} value={String(l[key]??'')} maxLength={key==='description'?12000:2000} placeholder={placeholder} onChange={e=>{change(key,e.target.value||null);if(key==='building'||key==='room')change('unit_split',true);}}/>,options);
  const long=(key:keyof LiveListing,label:string,placeholder:string,options:Parameters<typeof field>[3]={})=>field(key,label,<textarea {...attrs(key)} rows={4} maxLength={12000} value={String(l[key]??'')} placeholder={placeholder} onChange={e=>change(key,e.target.value||null)}/>,{wide:true,...options});
  const number=(key:'area'|'price'|'fee'|'owner_floor_price'|'longitude'|'latitude',label:string,unit:string,placeholder:string,options:Parameters<typeof field>[3]={})=>field(key,label,<div className="listing-unit-input"><input {...attrs(key)} type="number" inputMode="decimal" step={key==='latitude'||key==='longitude'?'0.000001':'0.01'} min={key==='latitude'?-90:key==='longitude'?-180:0} max={key==='latitude'?90:key==='longitude'?180:undefined} value={l[key]??''} placeholder={placeholder} onChange={e=>change(key,e.target.value===''?null:Number(e.target.value))}/><span>{unit}</span></div>,options);
  const yesno=(key:'has_agent_fee'|'has_crane_support'|'has_passenger_elevator'|'has_water',label:string,hint?:string)=>field(key,label,<select {...attrs(key)} value={l[key]===true?'yes':l[key]===false?'no':''} onChange={e=>change(key,e.target.value===''?null:e.target.value==='yes')}><option value="">请选择</option><option value="yes">有</option><option value="no">无</option></select>,{hint,scope:key==='has_agent_fee'?key:undefined});
  return <div className="listing-editor-layout"><ListingOutline industrial={industrial}/><div className="listing-editor-main">
    <section className="listing-category-card"><h3>房源业态</h3><div className="listing-category-options" role="group" aria-label="房源业态">{['写字楼','厂房'].map(category=><button type="button" key={category} aria-pressed={l.category===category} onClick={()=>change('category',category)}><Building2 size={17}/>{category}</button>)}</div>{!['写字楼','厂房'].includes(l.category)?<p>当前为历史业态「{l.category}」，可继续保留；选择新的业态后，已填写资料仍会保留。</p>:<p>{industrial?'已显示厂房技术条件，可按实际资料手填单位和说明。':'填写办公空间资料；选择厂房后将显示工业技术条件。'}</p>}</section>
    <Section id="basic" title="基本信息" description="让客户认出房源，也方便你在后台查找。">
      {field('title','对外房源标题',<input {...attrs('title')} value={l.title} maxLength={300} onChange={e=>change('title',e.target.value)} placeholder="例如：松山湖北部 · 133㎡带装修办公室"/>,{wide:true,required:true,hint:'标题会展示给客户，请勿包含需要保密的房号或内部信息。'})}
      {field('region','所属片区',<RegionSelector listing={l} onChange={value=>change('region',value)}/>,{wide:true,hint:'片区对外展示。资料不足时请保留待确认；园区、楼栋和房号固定仅后台可见。'})}
      {field('park','园区名称',<><input {...attrs('park')} value={l.park||''} list="listing-park-options" readOnly={parkOnly} onChange={e=>onPark(e.target.value)} placeholder="搜索或填写园区名称"/><datalist id="listing-park-options">{parks.filter(p=>p.active&&(!parkOnly||p.name===assignedPark)).map(p=><option key={p.id} value={p.name}/>)}</datalist></>,{required:true,hint:parkOnly?'当前账号管理园区，不能修改归属。':'用于内部房源归属，不向访客公开。'})}
      {field('internal_code','房源编号',<input {...attrs('internal_code')} value={l.internal_code||''} readOnly placeholder="首次保存时自动生成六位编号"/>,{hint:l.internal_code?'编号对外公开，方便客户电话报号；后续编辑保持不变。':'无需填写，保存时自动生成六位数字；发布后向客户展示。'})}
      {!l.unit_split&&l.unit&&<div className="listing-legacy wide"><strong>历史楼栋／房号：{l.unit}</strong><p>原始资料暂保留。填写下方楼栋或房号后将改为分开保存；任一项设为仅后台时，未拆分的原始资料会整体隐藏。</p></div>}
      {text('building','楼栋','例如：A栋')}{text('floor','楼层','例如：5楼、首层、整栋',{scope:'floor'})}{text('room','房号','例如：501')}
    </Section>
    <Section id="cost" title="租赁费用与条款" description="租金、物业费分开填写，每月费用自动汇总。">
      {number('price','租金单价','元/㎡·月','留空表示面议')}{number('fee','物业费单价','元/㎡·月','留空待确认，免费填0')}{number('owner_floor_price','业主底价','元/㎡·月','仅用于内部参考')}{text('payment_terms','支付方式','例如：押二付三，也可手动填写')}{text('free_rent_period','免租期','例如：1个月、可谈')}{yesno('has_agent_fee','中介费')}
      <div className="listing-cost-preview wide"><div><span>月租金</span><strong>{amount(fees.rentCents)}</strong></div><div><span>月物业费</span><strong>{amount(fees.feeCents)}</strong></div><div><span>每月合计</span><strong>{amount(fees.totalCents)}</strong></div></div><p className="listing-help wide">合计仅含租金与物业费，各项四舍五入到分后相加；免租期和中介费不计入。</p>
    </Section>
    <Section id="space" title="空间与装修" description="面积是每月租金和物业费的计算依据。">{number('area','面积','㎡','填写房源面积',{required:true})}{text('facing','朝向','例如：东南向')}{text('layout','格局',industrial?'例如：独栋、开放空间':'例如：2+1、无隔间')}{text('decoration','装修','例如：精装、带家具')}</Section>
    {industrial&&<Section id="factory" title="厂房技术条件" description="按实际资料手填，可带单位和补充说明；不确定的可暂留空。" optional>
      {text('compatible_industries','适配行业','填写适配行业及限制',{wide:true})}{text('factory_height','层高','例如：净高8m，请附单位与口径')}{text('factory_load','承重','例如：500kg/㎡，按原始资料填写')}{text('factory_power','配电','填写容量、单位及补充说明')}{text('fire_rating','消防','填写消防条件说明')}{long('environmental_requirements','环评','填写现有环评资料、环保要求及限制')}{yesno('has_crane_support','行车支撑（牛角）','指安装行车用的支撑，不代表已安装行车。')}{text('freight_elevator_load','货梯载重','例如：3吨')}{text('freight_elevator_size','货梯尺寸','填写长×宽×高及单位')}{yesno('has_passenger_elevator','客梯')}{yesno('has_water','上下水')}
    </Section>}
    <Section id="description" title="园区配套与房源说明" description="补充实际配套、交付条件和看房说明。" optional>{text('supporting_facilities','园区配套','例如：停车场、食堂、员工宿舍',{wide:true})}{long('description','房源说明','介绍房源特点、交付条件及看房说明，无需重复填写前面的参数。')}</Section>
    <Section id="location" title="内部地址资料" description="详细地址与坐标固定仅后台保存，不对访客公开；地图服务已停用。" optional>{text('address','详细地址','仅供内部管理',{wide:true})}{number('longitude','经度','°','仅后台保留，可留空')}{number('latitude','纬度','°','仅后台保留，可留空')}</Section>
    <Section id="contact" title="联系方式" description="对外招商顾问与内部房源联系人分开填写，互不覆盖。">
      <div className="listing-contact-group wide"><h4>招商顾问 · 对外公开</h4><p>客户在房源详情、拨打电话和预约看房时联系的人。</p><div className="listing-field-grid">
        {text('contact_name','招商顾问姓名','填写对外招商顾问姓名',{required:true})}
        {field('contact_phone','招商顾问电话',<input {...attrs('contact_phone')} type="tel" value={l.contact_phone||''} onChange={e=>change('contact_phone',e.target.value||null)} placeholder="填写对外联系电话"/>,{required:true})}
        {text('wechat','微信','选填微信号',{scope:'wechat'})}{text('video_channel','视频号','选填视频号名称或主页链接',{scope:'video_channel'})}
      </div></div>
      <div className="listing-contact-group private wide"><h4>房源联系人 · 仅后台可见</h4><p>填写业主或园区对接人，便于内部联络；不向客户展示，也不会替换上方招商顾问。可暂留空，请勿写入公开介绍。</p><div className="listing-field-grid">
        {text('owner_contact_name','房源联系人姓名','选填业主或园区对接人姓名')}
        {field('owner_contact_phone','房源联系人电话',<input {...attrs('owner_contact_phone')} type="tel" value={l.owner_contact_phone||''} onChange={e=>change('owner_contact_phone',e.target.value||null)} placeholder="选填内部联系电话"/>)}
      </div></div>
    </Section>
    <Section id="media" title="照片、视频与发布" description="第一张照片作为封面，发布前可预览客户看到的内容。"><div className="wide">{children}</div>{text('tag','推荐标签','例如：热门、特价、新上',{wide:true})}<details className="listing-internal wide"><summary>内部记录 · 仅后台可见</summary><div className="listing-field-grid">{long('channel_notes','渠道信息','记录房源渠道',{wide:false})}{long('followup_notes','跟进备注','记录内部跟进事项',{wide:false})}</div></details></Section>
  </div></div>;
}
export function ListingPreview({listing,onClose}:{listing:LiveListing;onClose:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),l=publicListingPreview(listing),fees=calculateFees(l.area,l.price,l.fee);
  useEffect(()=>{const node=ref.current;if(node&&!node.open)node.showModal();},[]);
  const specs=[['片区',l.region],['楼层',l.floor],['面积',l.area==null?null:`${l.area}㎡`],['朝向',l.facing],['格局',l.layout],['装修',l.decoration],['支付方式',l.payment_terms],['免租期',l.free_rent_period],['中介费',l.has_agent_fee==null?null:l.has_agent_fee?'有':'无'],...(isIndustrial(l.category)?technicalFields.map(([key,label])=>[label,typeof l[key]==='boolean'?(l[key]?'有':'无'):l[key]]):[])];
  return <dialog ref={ref} className="listing-preview-dialog" onClose={onClose}><header><div><ClipboardList size={18}/><strong>客户视角预览</strong><span>尚未保存本次修改</span></div><button type="button" onClick={()=>ref.current?.close()} aria-label="关闭预览"><X size={20}/></button></header><div className="listing-preview-content">{l.images[0]&&<img className="listing-preview-cover" src={l.images[0]} alt="房源封面"/>}<h2>{l.title||'房源标题待填写'}</h2>{l.listing_code&&<p className="workspace-listing-code">房源编号：{l.listing_code}</p>}<p className="listing-preview-category">{l.category} · {l.price==null?'租金面议':`${l.price}元/㎡·月`}</p><div className="listing-cost-preview"><div><span>月租金</span><strong>{amount(fees.rentCents)}</strong></div><div><span>月物业费</span><strong>{amount(fees.feeCents)}</strong></div><div><span>每月合计</span><strong>{amount(fees.totalCents)}</strong></div></div><dl className="listing-preview-specs">{specs.filter(([,value])=>value!=null&&value!=='').map(([label,value])=><div key={String(label)}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>{l.supporting_facilities&&<section><h3>园区配套</h3><p>{l.supporting_facilities}</p></section>}{l.description&&<section><h3>房源说明</h3><p>{l.description}</p></section>}{l.address&&<section><h3>详细地址</h3><p>{l.address}</p></section>}{l.latitude!=null&&l.longitude!=null&&<p>地图坐标：{l.longitude}, {l.latitude}</p>}<section><h3>招商联系</h3><p>{l.contact_name||'联系人待填写'} · {l.contact_phone||'电话待填写'}</p>{l.wechat&&<p>微信：{l.wechat}</p>}{l.video_channel&&<p>视频号：{l.video_channel}</p>}</section>{l.images.length>1&&<div className="listing-preview-images">{l.images.slice(1).map((url,i)=><img key={url} src={url} alt={`房源照片${i+2}`}/>)}</div>}{l.videos.map(url=><video key={url} src={url} controls preload="metadata"/>)}</div><footer><button className="admin-primary" type="button" onClick={()=>ref.current?.close()}>返回继续填写</button></footer></dialog>;
}
