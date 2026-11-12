'use client';
import { useState } from 'react';
import type { LiveListing } from '@/lib/backend';
import { PUBLIC_REGIONS, REGION_LABELS, isRegion, inferRegion, type Region } from '@/lib/regions';

type Suggestion={region:Region|null;reason:string};
export function RegionSelector({listing,onChange}:{listing:LiveListing;onChange:(region:Region|null)=>void}){
  const [suggestion,setSuggestion]=useState<(Suggestion&{source:string})|null>(null);
  const source=JSON.stringify({title:listing.title,park:listing.park,address:listing.address});
  function suggest(){
    const region=inferRegion(listing);
    setSuggestion({region,reason:region?'根据已填资料中的片区名称识别，请核对后采用。':'资料中没有唯一明确的片区，请手动确认。',source});
  }
  const result=suggestion?.source===source?suggestion:null;
  return <div><select id="listing-region" value={listing.region||''} onChange={e=>{onChange(isRegion(e.target.value)?e.target.value:null);setSuggestion(null);}}><option value="">待确认</option>{PUBLIC_REGIONS.map(region=><option key={region} value={region}>{REGION_LABELS[region]}</option>)}</select>
    <button type="button" disabled={!listing.park&&!listing.address&&!listing.title} onClick={suggest}>辅助识别片区</button>
    <small>仅在本机识别已填资料中的明确片区名称，不发送给外部 AI；不会自动保存。</small>
    {result?<div role="status"><p>{result.region?'建议：'+REGION_LABELS[result.region]:'暂无法确定片区'}。{result.reason}</p>{result.region?<button type="button" onClick={()=>{onChange(result.region);setSuggestion(null);}}>采用此建议</button>:null}</div>:null}
  </div>;
}
