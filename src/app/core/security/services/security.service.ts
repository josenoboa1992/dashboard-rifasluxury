import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface BlockedIp {
  id: number;
  ip_address: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedBlockedIpsResponse {
  current_page: number;
  data: BlockedIp[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
}

@Injectable({ providedIn: 'root' })
export class SecurityService {
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
   * GET /api/admin/security/blocked-ips
   * Paginación Laravel; `q` filtra por ip_address (LIKE parcial en servidor).
   */
  listBlockedIps(
    page: number = 1,
    perPage: number = 25,
    q?: string | null,
  ): Observable<PaginatedBlockedIpsResponse> {
    const clamped = Math.min(100, Math.max(1, Math.floor(perPage)));
    let params = new HttpParams().set('page', page).set('per_page', clamped);
    const term = (q ?? '').trim();
    if (term.length > 0) {
      params = params.set('q', term);
    }
    return this.http.get<PaginatedBlockedIpsResponse>(
      `${environment.apiBaseUrl}/api/admin/security/blocked-ips`,
      { headers: this.authHeaders(), params },
    );
  }

  /** POST /api/admin/security/blocked-ip/remove — body `{ "ip": "..." }`. */
  removeBlockedIp(ip: string): Observable<unknown> {
    return this.http.post(
      `${environment.apiBaseUrl}/api/admin/security/blocked-ip/remove`,
      { ip: ip.trim() },
      { headers: this.authHeaders() },
    );
  }
}
