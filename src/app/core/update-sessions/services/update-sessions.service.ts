import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';
import type {
  PaginatedUpdateSessions,
  UpdateSessionDetail,
  UpdateSessionMarkReadResponse,
  UpdateSessionsUnreadCountResponse,
} from '../models/update-session.model';

@Injectable({ providedIn: 'root' })
export class UpdateSessionsService {
  /** Sincronizado con `GET /api/update-sessions/unread-count`. */
  readonly unreadCount = signal(0);

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
  ) {}

  private headers(): HttpHeaders {
    const token = this.auth.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  refreshUnreadCount(): void {
    this.http
      .get<UpdateSessionsUnreadCountResponse>(`${environment.apiBaseUrl}/api/update-sessions/unread-count`, {
        headers: this.headers(),
      })
      .subscribe({
        next: (r) => this.unreadCount.set(Math.max(0, Number(r?.unread_count) || 0)),
        error: () => this.unreadCount.set(0),
      });
  }

  listPublished(page: number = 1, perPage: number = 15): Observable<PaginatedUpdateSessions> {
    const params = new HttpParams()
      .set('page', String(Math.max(1, page)))
      .set('per_page', String(Math.min(100, Math.max(1, perPage))));
    return this.http.get<PaginatedUpdateSessions>(`${environment.apiBaseUrl}/api/update-sessions`, {
      headers: this.headers(),
      params,
    });
  }

  /** Cuerpo completo; el backend registra lectura (`recordRead`) y devuelve `is_read` / `read_at`. */
  getPublished(id: number): Observable<UpdateSessionDetail> {
    return this.http
      .get<UpdateSessionDetail>(`${environment.apiBaseUrl}/api/update-sessions/${id}`, {
        headers: this.headers(),
      })
      .pipe(tap(() => this.refreshUnreadCount()));
  }

  /** Marcar leído sin volver a cargar el cuerpo. */
  markRead(id: number): Observable<UpdateSessionMarkReadResponse> {
    return this.http
      .post<UpdateSessionMarkReadResponse>(
        `${environment.apiBaseUrl}/api/update-sessions/${id}/read`,
        {},
        { headers: this.headers() },
      )
      .pipe(tap(() => this.refreshUnreadCount()));
  }
}
