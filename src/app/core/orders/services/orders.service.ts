import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface OrderRaffleSummary {
  id: number;
  title: string;
  tickets_available_count?: number;
  [key: string]: unknown;
}

export interface OrderParticipantSummary {
  id: number;
  name: string;
  cedula?: string | null;
  [key: string]: unknown;
}

export interface PaymentProofImage {
  id?: number;
  original_name?: string;
  file_name?: string;
  path?: string;
  url?: string;
  mime_type?: string;
  size?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Cuenta bancaria anidada en el listado/detalle de pedido (Laravel en `data[].bank_account`).
 * No incluye el mismo cuerpo que el CRUD de cuentas; el API embebe lo necesario.
 */
export interface OrderBankAccount {
  id: number;
  bank_name: string;
  account_type?: string;
  account_number?: string;
  account_holder_name?: string;
  holder_id?: string | null;
  currency?: string;
  image_id?: number | null;
  color?: string | null;
  sort_order?: number;
  image?: PaymentProofImage | null;
  [key: string]: unknown;
}

export interface OrderTicket {
  id: number;
  raffle_id: number;
  number: string;
  status?: string;
  reserved_until?: string | null;
  [key: string]: unknown;
}

/**
 * Modelo alineado con el recurso de pedido en `GET /api/admin/orders` y
 * `GET /api/admin/raffles/{id}/orders` (Laravel, dentro de `data[]`).
 */
export interface Order {
  id: number;
  raffle_id: number;
  user_id: number | null;
  participant_id: number | null;
  customer_name: string;
  cedula?: string | null;
  phone: string;
  /** Puede venir vacío o null desde el API en algunos pedidos. */
  email: string | null;
  /** Presente en el listado admin cuando el backend lo expone. */
  ip_address?: string | null;
  status: string;
  total_amount: string;
  /** Cantidad de boletos asociados. */
  tickets_count?: number | null;
  bank_account_id: number | null;
  /** Nombre descriptivo (denormalizado); también puede resolverse vía `bank_account`. */
  bank_name?: string | null;
  /** Cuenta bancaria embebida (Laravel) cuando el API la incluye. */
  bank_account?: OrderBankAccount | null;
  payment_proof_path: string | null;
  payment_proof_image_id: number | null;
  validated_at: string | null;
  expires_at: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  raffle?: OrderRaffleSummary;
  participant?: OrderParticipantSummary;
  payment_proof_image?: PaymentProofImage | null;
  tickets?: OrderTicket[];
  [key: string]: unknown;
}

/** Grupo de pedidos en una página del listado admin, por banco. */
export interface OrderBankGroup {
  bank_name: string;
  orders: Order[];
}

/**
 * `LengthAwarePaginator` de Laravel: mismo contrato en
 * `GET /api/admin/orders` y `GET /api/admin/raffles/{id}/orders`.
 * `data` = página actual de `Order` (a veces con relaciones: `raffle`, `participant`, `bank_account`, `payment_proof_image`).
 */
export interface PaginatedOrdersResponse {
  current_page: number;
  data: Order[];
  first_page_url?: string | null;
  from: number | null;
  last_page: number;
  last_page_url?: string | null;
  links?: Array<{
    url: string | null;
    label: string;
    active?: boolean;
    [key: string]: unknown;
  }>;
  next_page_url?: string | null;
  path?: string;
  per_page: number;
  prev_page_url?: string | null;
  to: number | null;
  total: number;
  /** @deprecated listado legado por banco; el backend standard usa solo `data` plana. */
  groups?: OrderBankGroup[];
  [key: string]: unknown;
}

const OTROS_BANK_LABEL = 'Otros';

/** Convierte la respuesta del GET admin en grupos; si solo viene `data`, un solo grupo. */
export function orderGroupsFromPaginatedOrdersResponse(res: PaginatedOrdersResponse): OrderBankGroup[] {
  const raw = res.groups;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((g) => ({
      bank_name: String((g as OrderBankGroup).bank_name ?? '').trim() || OTROS_BANK_LABEL,
      orders: Array.isArray((g as OrderBankGroup).orders) ? (g as OrderBankGroup).orders : [],
    }));
  }
  const flat = res.data ?? [];
  return flat.length > 0 ? [{ bank_name: 'Pedidos', orders: flat }] : [];
}

/** Lista plana de pedidos (p. ej. dashboard). */
export function flattenOrderGroups(groups: OrderBankGroup[] | null | undefined): Order[] {
  return (groups ?? []).flatMap((g) => g.orders ?? []);
}

/**
 * Lista plana de pedidos desde el GET admin.
 * Si el backend manda `groups` pero con `orders` vacíos (o estructura rara) y la lista
 * real va en `data`, hacemos fallback a `res.data` para no mostrar 0 resultados.
 */
export function ordersFlatFromPaginatedResponse(res: PaginatedOrdersResponse): Order[] {
  const fromGroups = flattenOrderGroups(orderGroupsFromPaginatedOrdersResponse(res));
  if (fromGroups.length > 0) {
    return fromGroups;
  }
  const direct = res.data;
  if (Array.isArray(direct) && direct.length > 0) {
    return direct as Order[];
  }
  return [];
}

/** Une grupos al cargar más páginas (mismo banco acumula órdenes; sin duplicar id). */
export function mergeOrderBankGroups(a: OrderBankGroup[], b: OrderBankGroup[]): OrderBankGroup[] {
  const map = new Map<string, Order[]>();
  const add = (bankName: string, orders: Order[]) => {
    const key = String(bankName ?? '').trim() || OTROS_BANK_LABEL;
    if (!map.has(key)) map.set(key, []);
    const arr = map.get(key)!;
    const ids = new Set(arr.map((x) => x.id));
    for (const o of orders) {
      if (!ids.has(o.id)) {
        arr.push(o);
        ids.add(o.id);
      }
    }
  };
  for (const g of a) add(g.bank_name, g.orders);
  for (const g of b) add(g.bank_name, g.orders);
  const keys = [...map.keys()].filter((k) => k !== OTROS_BANK_LABEL);
  keys.sort((x, y) => x.localeCompare(y, 'es', { sensitivity: 'base' }));
  const out: OrderBankGroup[] = keys.map((name) => ({ bank_name: name, orders: map.get(name)! }));
  if (map.has(OTROS_BANK_LABEL)) {
    out.push({ bank_name: OTROS_BANK_LABEL, orders: map.get(OTROS_BANK_LABEL)! });
  }
  return out;
}

/** Listado plano: une páginas sin reagrupar (evita lógica por banco; el campo `bank_name` en cada pedido basta). */
export function mergeOrderPages(existing: Order[], incomingFromPage: Order[]): Order[] {
  const ids = new Set(existing.map((o) => o.id));
  const out = [...existing];
  for (const o of incomingFromPage) {
    if (!ids.has(o.id)) {
      out.push(o);
      ids.add(o.id);
    }
  }
  return out;
}

export interface OrderReviewPayload {
  approved: boolean;
  admin_notes?: string | null;
}

/** Máximo de IDs por `POST /api/admin/orders/bulk-delete`. */
export const ORDERS_BULK_DELETE_MAX_IDS = 200;

export interface BulkOrderDeleteSkipped {
  id: number;
  reason: string;
}

export interface BulkOrdersDeleteResponse {
  deleted: number[];
  deleted_count: number;
  skipped: BulkOrderDeleteSkipped[];
  skipped_count: number;
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
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

  /**
   * Listado admin de pedidos (paginador Laravel estándar).
   * Puede filtrar por `raffle_id` en query o usar {@link listRaffleOrders} para la ruta anidada.
   */
  listOrders(
    page: number = 1,
    perPage: number = 25,
    status?: string | null,
    raffleId?: number | null,
    /** Texto libre; API admin: `GET ...?q=` (hasta 128 chars en servidor). */
    search?: string | null,
  ): Observable<PaginatedOrdersResponse> {
    let params = new HttpParams().set('page', page).set('per_page', perPage);
    if (status != null && String(status).trim() !== '') {
      params = params.set('status', String(status).trim());
    }
    if (raffleId != null && Number.isFinite(raffleId) && raffleId > 0) {
      params = params.set('raffle_id', String(Math.floor(raffleId)));
    }
    const q = search != null ? String(search).trim() : '';
    if (q !== '') {
      params = params.set('q', q.slice(0, 128));
    }
    return this.http.get<PaginatedOrdersResponse>(`${environment.apiBaseUrl}/api/admin/orders`, {
      headers: this.authHeaders(),
      params,
    });
  }

  /**
   * `GET /api/admin/raffles/{id}/orders` — mismo cuerpo paginado que `listOrders`
   * (Laravel: `data`, `current_page`, `last_page`, `path`, `links`, etc.).
   */
  listRaffleOrders(
    raffleId: number,
    page: number = 1,
    perPage: number = 25,
    status?: string | null,
    search?: string | null,
  ): Observable<PaginatedOrdersResponse> {
    if (!Number.isFinite(raffleId) || raffleId < 1) {
      throw new Error('listRaffleOrders: raffleId inválido');
    }
    let params = new HttpParams().set('page', page).set('per_page', perPage);
    if (status != null && String(status).trim() !== '') {
      params = params.set('status', String(status).trim());
    }
    const q = search != null ? String(search).trim() : '';
    if (q !== '') {
      params = params.set('q', q.slice(0, 128));
    }
    return this.http.get<PaginatedOrdersResponse>(
      `${environment.apiBaseUrl}/api/admin/raffles/${Math.floor(raffleId)}/orders`,
      { headers: this.authHeaders(), params },
    );
  }

  getOrder(id: number): Observable<Order> {
    return this.http.get<Order>(`${environment.apiBaseUrl}/api/admin/orders/${id}`, {
      headers: this.authHeaders(),
    });
  }

  reviewOrder(id: number, body: OrderReviewPayload): Observable<Order> {
    return this.http.post<Order>(`${environment.apiBaseUrl}/api/admin/orders/${id}/review`, body, {
      headers: this.authHeaders(),
    });
  }

  /**
   * Eliminar un pedido (admin).
   * DELETE /api/admin/orders/{order}
   */
  deleteOrder(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/api/admin/orders/${id}`, {
      headers: this.authHeaders(),
    });
  }

  /**
   * Eliminación masiva (admin). Máximo {@link ORDERS_BULK_DELETE_MAX_IDS} IDs por solicitud;
   * el cliente puede partir listas mayores en varias llamadas.
   * POST /api/admin/orders/bulk-delete
   */
  bulkDeleteOrders(orderIds: number[]): Observable<BulkOrdersDeleteResponse> {
    return this.http.post<BulkOrdersDeleteResponse>(
      `${environment.apiBaseUrl}/api/admin/orders/bulk-delete`,
      { order_ids: orderIds },
      { headers: this.authHeaders() },
    );
  }

  // ── Bloqueo de órdenes públicas ──────────────────────────────

  /** GET /api/admin/security/order-block → { blocked: boolean } */
  getOrderBlock(): Observable<{ blocked: boolean }> {
    return this.http.get<{ blocked: boolean }>(
      `${environment.apiBaseUrl}/api/admin/security/order-block`,
      { headers: this.authHeaders() },
    );
  }

  /** POST /api/admin/security/order-block → { blocked: boolean } */
  setOrderBlock(blocked: boolean): Observable<{ blocked: boolean }> {
    return this.http.post<{ blocked: boolean }>(
      `${environment.apiBaseUrl}/api/admin/security/order-block`,
      { blocked },
      { headers: this.authHeaders() },
    );
  }
}
