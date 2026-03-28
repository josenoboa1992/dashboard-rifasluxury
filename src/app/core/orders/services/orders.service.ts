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
  email: string;
  status: string;
  total_amount: string;
  bank_account_id: number | null;
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

export interface PaginatedOrdersResponse {
  current_page: number;
  data: Order[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

export interface OrderReviewPayload {
  approved: boolean;
  admin_notes?: string | null;
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
}
