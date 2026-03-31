/** Formato visual RD: 809-421-0692 o 1-809-421-0692 si lleva prefijo 1. */
export function formatDrPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (!d.length) return '';
  if (d.startsWith('1') && d.length > 1) {
    const rest = d.slice(1, 11);
    const body = formatThreeThreeFour(rest);
    return body.length ? `1-${body}` : '1';
  }
  return formatThreeThreeFour(d.slice(0, 10));
}

function formatThreeThreeFour(d: string): string {
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

/** Cédula dominicana: 402-2238237-2 (11 dígitos). */
export function formatDrCedula(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10, 11)}`;
}

export function digitsOnly(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}
