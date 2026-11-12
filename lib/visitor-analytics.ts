import type { SavedInquiry } from './backend';

export type VisitorSummary = { visitor_id:string; first_seen:string; last_seen:string; sessions:number; views:number };
export type VisitRecord = { id:number; listing_id:string|null; title:string|null; listing_code:string|null; created_at:string };
export type VisitPage<T> = { rows:T[]; total:number; page:number; page_size:number };

export const visitorCode = (id:string) => `访客-${id.replaceAll('-','').slice(0,12).toUpperCase()}`;

// These are submitted records, not verified identities or inferred links to visits.
export function activeLeadRecords(rows:SavedInquiry[]) {
  return rows.filter(row=>!row.deleted_at&&!row.visitor_withdrawn_at&&row.contact?.trim()&&row.phone?.trim())
    .sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||a.id.localeCompare(b.id));
}
