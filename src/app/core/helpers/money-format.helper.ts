/**
 * Formato de moneda para la UI: `RD$ 1,000.00`
 * Acepta número o string (p. ej. `100`, `100.5`, `1,000.00`, `RD$ 50.00` desde el API).
 */
export function formatMoneyDop(value: string | number | null | undefined): string {
  const n = parseMoneyNumber(value);
  if (n === null) return '';
  const formatted = n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `RD$ ${formatted}`;
}

/** Interpreta un monto para formatear; devuelve null si no es un número finito. */
export function parseMoneyNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const s = String(value).trim();
  if (!s) return null;
  const cleaned = s
    .replace(/^RD\$\s*/i, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
