// Reuse the exact same decimal arithmetic used by property pages and AI search.
import '../public/experience/fees.js';
type FeeApi={calculate:(area:unknown,rent:unknown,fee:unknown)=>{rentCents:number|null;feeCents:number|null;totalCents:number|null};formatCents:(value:number|null)=>string};
const api=()=> (globalThis as unknown as {SiteFees:FeeApi}).SiteFees;
export const calculateFees=(area:unknown,rent:unknown,fee:unknown)=>api().calculate(area,rent,fee);
export const amount=(cents:number|null)=>cents===null?'待确认':'¥'+api().formatCents(cents);
