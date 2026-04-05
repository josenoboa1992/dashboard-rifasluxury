import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface Participant {
  id: number;
  name: string;
  cedula: string | null;
  phone: string | null;
  email: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedParticipantsResponse {
  current_page: number;
  data: Participant[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

export interface ParticipantPayload {
  name: string;
  cedula: string | null;
  phone: string | null;
  email: string;
}

/** Respuesta de GET /api/admin/participants/client-history */
export interface ClientHistoryTotals {
  orders: number;
  raffles: number;
  tickets: number;
  amount: string;
}

/** Boleto jugado en una rifa (si el API lo incluye en `by_raffle`). */
export interface ClientHistoryTicketItem {
  number: string;
  status?: string;
  order_id?: number;
}

export interface ClientHistoryByRaffle {
  raffle_id: number;
  raffle_title: string;
  raffle_status: string;
  orders_count: number;
  tickets_count: number;
  total_amount: string;
  /** Lista de boletos en esa rifa (objetos o el API puede enviar solo números). */
  tickets?: Array<ClientHistoryTicketItem | string>;
  /** Alternativa: números de boleto (strings o números según el API). */
  ticket_numbers?: Array<string | number>;
  /** Desglose por estado dentro de esta rifa (pedidos, boletos, montos y números). */
  by_status?: ClientHistoryByStatus;
}

export interface SegmentThresholds {
  plata: number;
  oro: number;
  platinum: number;
}

/** Agregados por estado de pedido (confirmado, pendiente de validación, cancelado). */
export interface ClientHistoryByStatusBucket {
  orders_count: number;
  tickets_count: number;
  total_amount: string;
  ticket_numbers?: Array<string | number>;
  /** Alternativa al API: lista de boletos como objetos. */
  tickets?: Array<ClientHistoryTicketItem | string>;
}

export interface ClientHistoryByStatus {
  confirmed?: ClientHistoryByStatusBucket;
  pending_validation?: ClientHistoryByStatusBucket;
  cancelled?: ClientHistoryByStatusBucket;
}

/** Totales globales por estado (`orders` / `tickets` / `amount`, sin listado de números). */
export interface ClientHistoryTotalsByStatusBucket {
  orders: number;
  tickets: number;
  amount: string;
}

export interface ClientHistoryTotalsByStatus {
  confirmed?: ClientHistoryTotalsByStatusBucket;
  pending_validation?: ClientHistoryTotalsByStatusBucket;
  cancelled?: ClientHistoryTotalsByStatusBucket;
}

/** Cliente unificado devuelto por el historial (prioritario para autocompletar UI). */
export interface ClientHistoryClient {
  participant_id: number;
  name: string;
  cedula: string;
  phone: string;
  email: string;
}

export interface ClientHistoryResponse {
  found: boolean;
  /** Datos del cliente coincidente (nombre, cédula, teléfono, correo). */
  client?: ClientHistoryClient | null;
  /** Participantes vinculados a la búsqueda (detalle completo). */
  participants?: Participant[];
  segment: string;
  segment_label: string;
  /** Texto explicativo del criterio de segmentación (p. ej. solo confirmados). */
  segment_basis?: string | null;
  participant_ids: number[];
  totals: ClientHistoryTotals;
  /** Totales agregados por estado (sin `ticket_numbers`). */
  totals_by_status?: ClientHistoryTotalsByStatus;
  by_raffle: ClientHistoryByRaffle[];
  /** Umbrales de segmentación; el API puede enviar `null` o `[]` cuando no aplica. */
  segment_thresholds: SegmentThresholds | null | unknown[];
  /** Opcional: participante acotado en la búsqueda. */
  scoped_participant_id?: number | null;
  /** Legado: totales por estado con `ticket_numbers` a nivel raíz (si el API lo envía). */
  by_status?: ClientHistoryByStatus;
}

export interface ClientHistoryQuery {
  name?: string;
  cedula?: string;
  phone?: string;
  ticket_number?: string;
}

type LooseClientHistoryByStatus = ClientHistoryByStatus & {
  pendingValidation?: ClientHistoryByStatusBucket;
  pending?: ClientHistoryByStatusBucket;
  canceled?: ClientHistoryByStatusBucket;
};

type LooseClientHistoryByRaffle = ClientHistoryByRaffle & {
  byStatus?: ClientHistoryByStatus;
};

/** Convierte `ticket_numbers` en array (array JSON, objeto tipo mapa, etc.). */
export function coerceClientHistoryTicketNumbers(raw: unknown): Array<string | number> {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((x) => x != null && x !== '');
  }
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).filter(
      (v) => v != null && v !== '',
    ) as Array<string | number>;
  }
  return [];
}

function normalizeStatusBucket(b: unknown): ClientHistoryByStatusBucket | undefined {
  if (b == null) return undefined;
  if (Array.isArray(b)) {
    const ticket_numbers = coerceClientHistoryTicketNumbers(b);
    return {
      orders_count: 0,
      tickets_count: ticket_numbers.length,
      total_amount: '0',
      ticket_numbers,
    };
  }
  if (typeof b !== 'object') return undefined;
  const o = b as ClientHistoryByStatusBucket;
  const ticket_numbers = coerceClientHistoryTicketNumbers(o.ticket_numbers);
  return {
    orders_count: Number(o.orders_count ?? 0),
    tickets_count: Number(o.tickets_count ?? 0),
    total_amount: String(o.total_amount ?? '0'),
    ticket_numbers,
    tickets: o.tickets,
  };
}

function normalizeByStatus(
  raw: LooseClientHistoryByStatus | ClientHistoryByStatus | null | undefined,
): ClientHistoryByStatus | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const u = raw as LooseClientHistoryByStatus;
  const out: ClientHistoryByStatus = {
    confirmed: normalizeStatusBucket(u.confirmed),
    pending_validation: normalizeStatusBucket(
      u.pending_validation ?? u.pendingValidation ?? u.pending,
    ),
    cancelled: normalizeStatusBucket(u.cancelled ?? u.canceled),
  };
  const hasAny =
    out.confirmed != null || out.pending_validation != null || out.cancelled != null;
  return hasAny ? out : undefined;
}

function pickByStatusFromRaffleRow(row: ClientHistoryByRaffle): ClientHistoryByStatus | undefined {
  const r = row as LooseClientHistoryByRaffle;
  return normalizeByStatus((row.by_status ?? r.byStatus) as LooseClientHistoryByStatus);
}

function normalizeClientHistoryResponse(res: ClientHistoryResponse): ClientHistoryResponse {
  const by_raffle = (res.by_raffle ?? []).map((row) => {
    const normalized = pickByStatusFromRaffleRow(row);
    return {
      ...row,
      by_status: normalized ?? row.by_status,
    };
  });
  return { ...res, by_raffle };
}

@Injectable({ providedIn: 'root' })
export class ParticipantsService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
  ) {}

  private authHeaders(): HttpHeaders {
    const token = this.auth.getToken();
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  listParticipants(page: number = 1, perPage: number = 15): Observable<PaginatedParticipantsResponse> {
    const params = new HttpParams()
      .set('page', page)
      .set('per_page', perPage);
    return this.http.get<PaginatedParticipantsResponse>(
      `${environment.apiBaseUrl}/api/participants`,
      { headers: this.authHeaders(), params },
    );
  }

  createParticipant(payload: ParticipantPayload): Observable<Participant> {
    return this.http.post<Participant>(
      `${environment.apiBaseUrl}/api/participants`,
      payload,
      { headers: this.authHeaders() },
    );
  }

  getParticipant(participantId: number): Observable<Participant> {
    return this.http.get<Participant>(
      `${environment.apiBaseUrl}/api/participants/${participantId}`,
      { headers: this.authHeaders() },
    );
  }

  updateParticipant(
    participantId: number,
    payload: Partial<ParticipantPayload>,
  ): Observable<Participant> {
    return this.http.patch<Participant>(
      `${environment.apiBaseUrl}/api/participants/${participantId}`,
      payload,
      { headers: this.authHeaders() },
    );
  }

  deleteParticipant(participantId: number): Observable<unknown> {
    return this.http.delete(
      `${environment.apiBaseUrl}/api/participants/${participantId}`,
      { headers: this.authHeaders() },
    );
  }

  /**
   * Requiere al menos uno: name, cedula, phone o ticket_number.
   * GET /api/admin/participants/client-history
   */
  getClientHistory(query: ClientHistoryQuery): Observable<ClientHistoryResponse> {
    let params = new HttpParams();
    const name = query.name?.trim();
    const cedula = query.cedula?.replace(/\D/g, '') ?? '';
    const phone = query.phone?.replace(/\D/g, '') ?? '';
    const ticket = query.ticket_number?.trim();
    if (name) params = params.set('name', name);
    if (cedula) params = params.set('cedula', cedula);
    if (phone) params = params.set('phone', phone);
    if (ticket) params = params.set('ticket_number', ticket);
    return this.http
      .get<ClientHistoryResponse>(
        `${environment.apiBaseUrl}/api/admin/participants/client-history`,
        { headers: this.authHeaders(), params },
      )
      .pipe(map(normalizeClientHistoryResponse));
  }
}

