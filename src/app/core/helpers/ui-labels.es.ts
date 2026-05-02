/** Etiquetas en español para panel admin (valores API en inglés/snake_case). */

export function roleLabelEs(role: string | null | undefined): string {
  if (role == null || String(role).trim() === '') return '—';
  const k = String(role).toLowerCase().trim();
  const map: Record<string, string> = {
    admin: 'Administrador',
    user: 'Usuario',
    support: 'Soporte',
    soporte: 'Soporte',
  };
  return map[k] ?? String(role);
}

export function raffleStatusLabelEs(status: string | null | undefined): string {
  if (status == null || String(status).trim() === '') return '—';
  const k = String(status).toLowerCase().trim();
  const map: Record<string, string> = {
    draft: 'Borrador',
    active: 'Activa',
    completed: 'Completada',
    cancelled: 'Cancelada',
    drawn: 'Sorteada',
    closed: 'Cerrada',
    open: 'Abierta',
    finished: 'Finalizada',
  };
  return map[k] ?? String(status);
}

/** Pedidos admin + estados de boleto (sold, reserved, …) en el mismo mapa. */
export function orderStatusLabelEs(status: string | null | undefined): string {
  if (status == null || String(status).trim() === '') return '—';
  const k = String(status).toLowerCase().trim();
  const map: Record<string, string> = {
    pending_validation: 'Revisando',
    pending_payment: 'Apartado',
    confirmed: 'Pagado',
    cancelled: 'Cancelado',
    sold: 'Vendido',
    reserved: 'Reservado',
    available: 'Disponible',
  };
  return map[k] ?? String(status);
}
