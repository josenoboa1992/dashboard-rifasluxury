/**
 * Formato de visualización: "27 mar 2026 - 11:00 am"
 * Fecha en español (mes corto en minúsculas), hora en 12h en minúsculas.
 */
export function formatDateTimeDisplay(
  value: string | Date | number | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  const dateFormatter = new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const dateParts = dateFormatter.formatToParts(d);
  let day = '';
  let month = '';
  let year = '';
  for (const p of dateParts) {
    if (p.type === 'day') day = p.value;
    if (p.type === 'month') month = p.value.replace(/\./g, '').trim().toLowerCase();
    if (p.type === 'year') year = p.value;
  }
  const dateStr = [day, month, year].filter(Boolean).join(' ');

  const timeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(d)
    .toLowerCase();

  return `${dateStr} - ${timeStr}`;
}
