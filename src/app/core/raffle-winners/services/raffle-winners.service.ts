import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface WinnerPortraitImage {
  id: number;
  original_name: string;
  file_name: string;
  path: string;
  url: string;
  mime_type: string;
  size: number;
  created_at: string;
  updated_at: string;
}

export interface RaffleWinner {
  id: number;
  raffle_id: number;
  ticket_id: number;
  participant_id: number | null;
  portrait_image_id: number | null;
  display_name: string | null;
  prize_label: string;
  drawn_at: string | null;
  ticket?: { number?: string; id?: number; [key: string]: unknown } | null;
  participant?: unknown;
  portrait_image?: WinnerPortraitImage | null;
  raffle?: unknown;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface PaginatedWinnersResponse {
  current_page: number;
  data: RaffleWinner[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

export interface CreateWinnerPayload {
  number: string;
  prize_label: string;
  display_name?: string;
  mark_drawn?: boolean;
  photo?: File | null;
}

export interface BulkWinnerRow {
  number: string;
  prize_label: string;
  display_name?: string;
  photo?: File | null;
}

export interface UpdateWinnerPayload {
  prize_label?: string;
  display_name?: string;
  photo?: File | null;
}

@Injectable({ providedIn: 'root' })
export class RaffleWinnersService {
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

  listWinners(
    raffleId: number,
    page: number = 1,
    perPage: number = 25,
  ): Observable<PaginatedWinnersResponse> {
    const params = new HttpParams().set('page', page).set('per_page', perPage);
    return this.http.get<PaginatedWinnersResponse>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/winners`,
      { headers: this.authHeaders(), params },
    );
  }

  createWinner(raffleId: number, payload: CreateWinnerPayload): Observable<RaffleWinner> {
    const fd = new FormData();
    fd.set('number', payload.number.trim());
    fd.set('prize_label', payload.prize_label.trim());
    if (payload.display_name?.trim()) {
      fd.set('display_name', payload.display_name.trim());
    }
    fd.set('mark_drawn', payload.mark_drawn ? '1' : '0');
    if (payload.photo) {
      fd.set('photo', payload.photo);
    }
    return this.http.post<RaffleWinner>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/winners`,
      fd,
      { headers: this.authHeaders() },
    );
  }

  bulkCreateWinners(
    raffleId: number,
    winners: BulkWinnerRow[],
    markDrawn: boolean,
  ): Observable<unknown> {
    const fd = new FormData();
    winners.forEach((w, i) => {
      fd.append(`winners[${i}][number]`, w.number.trim());
      fd.append(`winners[${i}][prize_label]`, w.prize_label.trim());
      if (w.display_name?.trim()) {
        fd.append(`winners[${i}][display_name]`, w.display_name.trim());
      }
      if (w.photo) {
        fd.append(`winners[${i}][photo]`, w.photo);
      }
    });
    fd.set('mark_drawn', markDrawn ? '1' : '0');
    return this.http.post(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/winners/bulk`,
      fd,
      { headers: this.authHeaders() },
    );
  }

  updateWinner(
    raffleId: number,
    winnerId: number,
    payload: UpdateWinnerPayload,
  ): Observable<RaffleWinner> {
    const fd = new FormData();
    if (payload.prize_label !== undefined) {
      fd.set('prize_label', payload.prize_label.trim());
    }
    if (payload.display_name !== undefined) {
      fd.set('display_name', payload.display_name.trim());
    }
    if (payload.photo) {
      fd.set('photo', payload.photo);
    }
    return this.http.patch<RaffleWinner>(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/winners/${winnerId}`,
      fd,
      { headers: this.authHeaders() },
    );
  }

  deleteWinner(raffleId: number, winnerId: number): Observable<unknown> {
    return this.http.delete(
      `${environment.apiBaseUrl}/api/admin/raffles/${raffleId}/winners/${winnerId}`,
      { headers: this.authHeaders() },
    );
  }
}
