import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface Raffle {
  id: number;
  category_id: number;
  image_id: number | null;
  image?: {
    id?: number;
    url?: string;
    [key: string]: unknown;
  } | null;
  banner_image: string | null;
  title: string;
  description: string;
  ticket_goal: number;
  ticket_price: number | string;
  max_tickets_per_user: number;
  min_tickets_per_user: number;
  winners_count: number;
  digit_count: number;
  status: string;
  starts_at: string;
  ends_at: string;
  draw_at: string;
  tickets_available_count?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface PaginatedRafflesResponse {
  current_page: number;
  data: Raffle[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

export interface RafflePayload {
  category_id: number;
  image_id?: number | null;
  title: string;
  description: string;
  ticket_goal: number;
  ticket_price: number;
  max_tickets_per_user: number;
  min_tickets_per_user: number;
  winners_count: number;
  digit_count: number;
  status: string;
  starts_at: string;
  ends_at: string;
  draw_at: string;
}

export interface PaginatedAvailableTicketsResponse {
  current_page: number;
  data: string[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

/** Participante en pedido (relación en tickets vendidos). */
export interface SoldTicketParticipant {
  id: number;
  name: string;
  cedula: string | null;
  email: string;
  phone: string | null;
  [key: string]: unknown;
}

/** Pedido asociado al boleto; el más reciente va primero en el array `orders` del ticket. */
export interface SoldTicketOrder {
  id: number;
  status?: string;
  participant?: SoldTicketParticipant | null;
  [key: string]: unknown;
}

/**
 * GET /api/admin/raffles/{raffle}/tickets/sold — filas `sold`, orden por `number`,
 * con `orders` (más reciente primero) y `participant` en cada pedido si existe.
 */
export interface RaffleTicketSold {
  id: number;
  number: string;
  status: string;
  raffle_id?: number;
  orders?: SoldTicketOrder[];
  /** Legado / otros formatos */
  participant_id?: number | null;
  participant?: SoldTicketParticipant | null;
  sold_at?: string | null;
  updated_at?: string;
  created_at?: string;
  [key: string]: unknown;
}

/** Paginación Laravel estándar (data + meta + links). */
export interface LaravelSoldTicketsMeta {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from?: number | null;
  to?: number | null;
  [key: string]: unknown;
}

export interface PaginatedSoldTicketsResponse {
  data: RaffleTicketSold[];
  /** Si el API usa meta (Laravel) */
  meta?: LaravelSoldTicketsMeta;
  links?: Record<string, unknown>;
  /** Si el API aplana como otros listados admin */
  current_page?: number;
  from?: number | null;
  last_page?: number;
  per_page?: number;
  to?: number | null;
  total?: number;
  [key: string]: unknown;
}

/** GET .../raffles/{id}/tickets/participant-by-number?number= */
export interface TicketParticipantByNumberResponse {
  raffle: { id: number; title: string };
  ticket: { id: number; number: string; status: string };
  participant: {
    id: number;
    name: string;
    cedula: string | null;
    phone: string | null;
    email: string;
    email_verified_at: string | null;
    created_at: string;
    updated_at: string;
  };
  order: {
    id: number;
    status: string;
    customer_name: string;
    cedula: string | null;
    phone: string | null;
    email: string;
  };
}

@Injectable({ providedIn: 'root' })
export class RafflesService {
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

  listRaffles(page: number = 1, perPage: number = 25, status?: string): Observable<PaginatedRafflesResponse> {
    let params = new HttpParams()
      .set('page', page)
      .set('per_page', perPage);
    if (status && status.trim()) {
      params = params.set('status', status.trim());
    }
    return this.http.get<PaginatedRafflesResponse>(
      `${environment.apiBaseUrl}/api/admin/raffles`,
      { headers: this.authHeaders(), params },
    );
  }

  createRaffle(payload: RafflePayload): Observable<Raffle> {
    return this.createRaffleMultipart(payload, null);
  }

  createRaffleMultipart(payload: RafflePayload, bannerImageFile: File | null): Observable<Raffle> {
    const formData = new FormData();
    formData.set('category_id', String(payload.category_id));
    if (payload.image_id !== null && payload.image_id !== undefined) {
      formData.set('image_id', String(payload.image_id));
    }
    if (bannerImageFile) {
      formData.set('banner_image', bannerImageFile);
    }
    formData.set('title', payload.title);
    formData.set('description', payload.description);
    formData.set('ticket_goal', String(payload.ticket_goal));
    formData.set('ticket_price', String(payload.ticket_price));
    formData.set('max_tickets_per_user', String(payload.max_tickets_per_user));
    formData.set('min_tickets_per_user', String(payload.min_tickets_per_user));
    formData.set('winners_count', String(payload.winners_count));
    formData.set('digit_count', String(payload.digit_count));
    formData.set('status', payload.status);
    formData.set('starts_at', payload.starts_at);
    formData.set('ends_at', payload.ends_at);
    formData.set('draw_at', payload.draw_at);

    return this.http.post<Raffle>(
      `${environment.apiBaseUrl}/api/admin/raffles`,
      formData,
      { headers: this.authHeaders() },
    );
  }

  getRaffle(raffleId: number): Observable<Raffle> {
    return this.http.get<Raffle>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}`,
      { headers: this.authHeaders() },
    );
  }

  updateRaffle(raffleId: number, payload: Partial<RafflePayload>): Observable<Raffle> {
    return this.updateRaffleMultipart(raffleId, payload, null);
  }

  updateRaffleMultipart(
    raffleId: number,
    payload: Partial<RafflePayload>,
    bannerImageFile: File | null,
  ): Observable<Raffle> {
    const formData = new FormData();
    if (payload.category_id !== undefined && payload.category_id !== null) {
      formData.set('category_id', String(payload.category_id));
    }
    if (payload.image_id !== undefined && payload.image_id !== null) {
      formData.set('image_id', String(payload.image_id));
    }
    if (bannerImageFile) {
      formData.set('banner_image', bannerImageFile);
    }
    if (payload.title !== undefined) formData.set('title', payload.title);
    if (payload.description !== undefined) formData.set('description', payload.description);
    if (payload.ticket_goal !== undefined) formData.set('ticket_goal', String(payload.ticket_goal));
    if (payload.ticket_price !== undefined) formData.set('ticket_price', String(payload.ticket_price));
    if (payload.max_tickets_per_user !== undefined) {
      formData.set('max_tickets_per_user', String(payload.max_tickets_per_user));
    }
    if (payload.min_tickets_per_user !== undefined) {
      formData.set('min_tickets_per_user', String(payload.min_tickets_per_user));
    }
    if (payload.winners_count !== undefined) formData.set('winners_count', String(payload.winners_count));
    if (payload.digit_count !== undefined) formData.set('digit_count', String(payload.digit_count));
    if (payload.status !== undefined) formData.set('status', payload.status);
    if (payload.starts_at !== undefined) formData.set('starts_at', payload.starts_at);
    if (payload.ends_at !== undefined) formData.set('ends_at', payload.ends_at);
    if (payload.draw_at !== undefined) formData.set('draw_at', payload.draw_at);

    return this.http.post<Raffle>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}`,
      formData,
      { headers: this.authHeaders() },
    );
  }

  deleteRaffle(raffleId: number): Observable<unknown> {
    return this.http.delete(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}`,
      { headers: this.authHeaders() },
    );
  }

  getAvailableTickets(
    raffleId: number,
    page: number = 1,
    perPage: number = 50,
  ): Observable<PaginatedAvailableTicketsResponse> {
    const params = new HttpParams()
      .set('page', page)
      .set('per_page', perPage);
    return this.http.get<PaginatedAvailableTicketsResponse>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/tickets/available`,
      { headers: this.authHeaders(), params },
    );
  }

  /**
   * GET /api/admin/raffles/{id}/tickets/sold
   * Query: page (default 1), per_page (default 50, max 500). JWT Bearer.
   */
  listSoldTickets(
    raffleId: number,
    page: number = 1,
    perPage: number = 50,
  ): Observable<PaginatedSoldTicketsResponse> {
    const safePage = Math.max(1, page);
    const safePer = Math.min(500, Math.max(1, perPage));
    const params = new HttpParams()
      .set('page', safePage)
      .set('per_page', safePer);
    return this.http.get<PaginatedSoldTicketsResponse>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/tickets/sold`,
      { headers: this.authHeaders(), params },
    );
  }

  /** Detalle de un boleto de la rifa (admin). */
  getRaffleTicket(raffleId: number, ticketId: number): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/tickets/${ticketId}`,
      { headers: this.authHeaders() },
    );
  }

  getTicketParticipantByNumber(
    raffleId: number,
    number: string,
  ): Observable<TicketParticipantByNumberResponse> {
    const params = new HttpParams().set('number', number.trim());
    return this.http.get<TicketParticipantByNumberResponse>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/tickets/participant-by-number`,
      { headers: this.authHeaders(), params },
    );
  }
}

