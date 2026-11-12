/* Canonical fee arithmetic shared by the browser and the AI Edge Function.
   Non-negative decimal inputs; round each monthly charge half-up to cents,
   then sum those cents. Missing area/rate is unknown, never an implicit zero. */
(function (root) {
  'use strict';
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  function decimal(value) {
    if (value == null || typeof value === 'boolean') return null;
    const raw = String(value).trim();
    if (!raw || raw.length > 64) return null;
    const match = raw.match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!match) return null;
    const exponent = Number(match[3] || 0);
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 40) return null;
    const fraction = match[2] || '';
    let numerator = BigInt(match[1] + fraction), scale = fraction.length - exponent;
    if (scale < 0) { numerator *= 10n ** BigInt(-scale); scale = 0; }
    return { numerator, scale };
  }
  function monthlyCharge(area, rate) {
    const a = decimal(area), b = decimal(rate);
    if (!a || a.numerator <= 0n || !b) return null;
    const denominator = 10n ** BigInt(a.scale + b.scale);
    const numerator = a.numerator * b.numerator * 100n;
    const cents = (numerator * 2n + denominator) / (denominator * 2n);
    return cents <= maximum ? Number(cents) : null;
  }
  function calculate(area, rent, fee) {
    const rentCents = monthlyCharge(area, rent), feeCents = monthlyCharge(area, fee);
    const sum = rentCents !== null && feeCents !== null ? rentCents + feeCents : null;
    return { rentCents, feeCents, totalCents: sum !== null && Number.isSafeInteger(sum) ? sum : null };
  }
  function budgetCents(value) {
    const amount = decimal(value);
    if (!amount) return null;
    // A hard budget is never rounded upward.
    const cents = amount.numerator * 100n / (10n ** BigInt(amount.scale));
    return cents <= maximum ? Number(cents) : null;
  }
  function withinBudget(area, rent, fee, budget, includesFee) {
    const costs = calculate(area, rent, fee), limit = budgetCents(budget);
    const amount = includesFee ? costs.totalCents : costs.rentCents;
    return amount !== null && limit !== null && amount <= limit;
  }
  function feeMode(query) {
    const value = String(query || '').replace(/\s/g, '');
    if (/不(?:包)?含(?:物业|管理)费?|(?:物业|管理)费另计/.test(value)) return false;
    if (/(?:包)?含(?:物业|管理)费?|(?:租金|房租)加(?:物业|管理)费?|(?:物业|管理)费?.*合计|总预算|总费用/.test(value)) return true;
    if (/月租|月预算/.test(value)) return false;
    return null;
  }
  function formatCents(cents) {
    if (!Number.isSafeInteger(cents) || cents < 0) return '待确认';
    return Math.floor(cents / 100).toLocaleString('zh-CN') + '.' + String(cents % 100).padStart(2, '0');
  }
  root.SiteFees = Object.freeze({ calculate, budgetCents, withinBudget, formatCents, feeMode });
})(globalThis);
