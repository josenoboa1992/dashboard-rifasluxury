import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';
import type { AdminUpdateSessionRow, PaginatedAdminUpdateSessions } from '../models/update-session.model';

export interface AdminUpdateSessionPayload {
  title: string;
  body: string;
  published_at?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AdminUpdateSessionsService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
  ) {}

  private headers(): HttpHeaders {
    const token = this.auth.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  list(page: number = 1, perPage: number = 25): Observable<PaginatedAdminUpdateSessions> {
    const params = new HttpParams()
      .set('page', String(Math.max(1, page)))
      .set('per_page', String(Math.min(100, Math.max(1, perPage))));
    return this.http.get<PaginatedAdminUpdateSessions>(`${environment.apiBaseUrl}/api/admin/update-sessions`, {
      headers: this.headers(),
      params,
    });
  }

  get(id: number): Observable<AdminUpdateSessionRow> {
    return this.http.get<AdminUpdateSessionRow>(`${environment.apiBaseUrl}/api/admin/update-sessions/${id}`, {
      headers: this.headers(),
    });
  }

  create(body: AdminUpdateSessionPayload): Observable<AdminUpdateSessionRow> {
    return this.http.post<AdminUpdateSessionRow>(`${environment.apiBaseUrl}/api/admin/update-sessions`, body, {
      headers: this.headers(),
    });
  }

  patch(id: number, body: Partial<AdminUpdateSessionPayload>): Observable<AdminUpdateSessionRow> {
    return this.http.patch<AdminUpdateSessionRow>(
      `${environment.apiBaseUrl}/api/admin/update-sessions/${id}`,
      body,
      { headers: this.headers() },
    );
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/api/admin/update-sessions/${id}`, {
      headers: this.headers(),
    });
  }
}
