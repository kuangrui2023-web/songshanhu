export function listingCode(value: unknown): string | null {
  const match=String(value??'').normalize('NFKC').trim().match(/^(?:(?:房源编号|房源|编号)\s*[:#]?\s*|#\s*)?([0-9]{6})$/);
  return match?.[1]??null;
}
