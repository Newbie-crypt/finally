/** Display formatters. All numbers render with tabular figures (see globals.css). */

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return currency.format(value);
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return compactCurrency.format(value);
}

/** Signed currency, e.g. "+$1,204.50" / "-$88.10". */
export function fmtSignedPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${currency.format(Math.abs(value))}`;
}

/** Signed percentage, e.g. "+1.24%". */
export function fmtPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** Shares: integers stay clean, fractional shares keep up to 4 places. */
export function fmtQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number.isInteger(value) ? value.toString() : value.toFixed(4).replace(/0+$/, '');
}

/** Tailwind text color for a signed value. */
export function pnlColor(value: number | null | undefined): string {
  if (!value) return 'text-flat';
  return value > 0 ? 'text-up' : 'text-down';
}

/** Clock time from a unix-seconds timestamp. */
export function fmtTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
