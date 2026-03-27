import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

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
}

