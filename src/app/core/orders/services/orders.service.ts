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
  cedula: string;
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

export interface OrderTicket {
  id: number;
  raffle_id: number;
  number: string;
  status?: string;
  reserved_until?: string | null;
  [key: string]: unknown;
}

export interface Order {
  id: number;
  raffle_id: number;
  user_id: number | null;
  participant_id: number | null;
  customer_name: string;
  cedula: string;
  phone: string;
  /** Puede venir vacío o null desde el API en algunos pedidos. */
  email: string | null;
  status: string;
  total_amount: string;
  /** Cantidad de boletos asociados (nuevo en el endpoint). */
  tickets_count?: number | null;
  bank_account_id: number | null;
  /** Nombre del banco de la cuenta ligada, o "Otros" si no aplica (listado admin). */
  bank_name?: string | null;
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

export interface PaginatedOrdersResponse {
  current_page: number;
  /** Respuesta nueva: pedidos agrupados por banco (misma paginación sobre órdenes). */
  groups?: OrderBankGroup[];
  /** Respuesta antigua: lista plana (compatibilidad). */
  data?: Order[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
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

/** Una sola lectura de la respuesta paginada admin → pedidos en orden de grupos. */
export function ordersFlatFromPaginatedResponse(res: PaginatedOrdersResponse): Order[] {
  return flattenOrderGroups(orderGroupsFromPaginatedOrdersResponse(res));
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

  listOrders(
    page: number = 1,
    perPage: number = 25,
    status?: string | null,
  ): Observable<PaginatedOrdersResponse> {
    let params = new HttpParams().set('page', page).set('per_page', perPage);
    if (status != null && String(status).trim() !== '') {
      params = params.set('status', String(status).trim());
    }
    return this.http.get<PaginatedOrdersResponse>(`${environment.apiBaseUrl}/api/admin/orders`, {
      headers: this.authHeaders(),
      params,
    });
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
