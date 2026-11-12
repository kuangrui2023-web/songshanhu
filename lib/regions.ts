export const PUBLIC_REGIONS=['北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城'] as const;
export type Region=typeof PUBLIC_REGIONS[number];
// Preserve existing saved values while making the administrator's options explicit.
export const REGION_LABELS:Record<Region,string>={北部:'松山湖北部',中部:'松山湖中部',南部:'松山湖南部',生态园:'松山湖生态园',大朗:'大朗',寮步:'寮步',大岭山:'大岭山',东城:'东城',南城:'南城'};
export const isRegion=(value:unknown):value is Region=>typeof value==='string'&&(PUBLIC_REGIONS as readonly string[]).includes(value);
export function inferRegion(facts:{title?:string|null;park?:string|null;address?:string|null}):Region|null{
  const text=[facts.title,facts.park,facts.address].filter(Boolean).join(' ');
  const matches=PUBLIC_REGIONS.filter(region=>text.includes(region));
  return matches.length===1?matches[0]:null;
}
