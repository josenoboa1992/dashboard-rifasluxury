import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface BankAccountImage {
  id?: number;
  url?: string;
  path?: string;
  mime_type?: string;
  [key: string]: unknown;
}

export interface BankAccount {
  id: number;
  bank_name: string;
  account_type: string;
  account_number: string;
  account_holder_name: string;
  holder_id: string | null;
  currency: string;
  is_active: boolean;
  sort_order: number;
  color: string | null;
  image_id: number | null;
  image?: BankAccountImage | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface PaginatedBankAccountsResponse {
  current_page: number;
  data: BankAccount[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface BankAccountPayload {
  bank_name: string;
  account_type: string;
  account_number: string;
  account_holder_name: string;
  holder_id: string | null;
  currency: string;
  is_active: boolean;
  sort_order: number;
  color: string | null;
}

@Injectable({ providedIn: 'root' })
export class BankAccountsService {
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
   * Acepta:
   * - `[...]` array JSON directo (tu API actual)
   * - `{ data: [...], current_page, ... }`
   * - `{ data: [...], meta: { current_page, ... } }`
   * - envoltorio `{ data: { data: [...], meta } } }`
   */
  private normalizeListResponse(body: unknown, page: number, perPage: number): PaginatedBankAccountsResponse {
    if (Array.isArray(body)) {
      const all = body as BankAccount[];
      const total = all.length;
      const safePer = Math.max(1, perPage);
      const lastPage = total === 0 ? 1 : Math.max(1, Math.ceil(total / safePer));
      const safePage = Math.min(Math.max(1, page), lastPage);
      const start = (safePage - 1) * safePer;
      const slice = all.slice(start, start + safePer);
      const from = total === 0 ? 0 : start + 1;
      const to = total === 0 ? 0 : start + slice.length;
      return {
        data: slice,
        current_page: safePage,
        last_page: lastPage,
        per_page: safePer,
        from,
        to,
        total,
      };
    }

    const res =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    let root: Record<string, unknown> = res;
    const topData = res['data'];
    if (topData && typeof topData === 'object' && !Array.isArray(topData)) {
      const nested = topData as Record<string, unknown>;
      if (Array.isArray(nested['data']) || nested['meta'] != null) {
        root = nested;
      }
    }

    const meta = root['meta'] as Record<string, unknown> | undefined;

    const asRows = (x: unknown): BankAccount[] => (Array.isArray(x) ? (x as BankAccount[]) : []);

    let rows = asRows(root['data']);
    if (!rows.length) {
      rows = asRows(res['data']);
    }
    if (!rows.length) {
      for (const key of ['bank_accounts', 'accounts', 'items']) {
        const alt = root[key] ?? res[key];
        if (Array.isArray(alt)) {
          rows = alt as BankAccount[];
          break;
        }
      }
    }

    if (meta && typeof meta === 'object') {
      return {
        data: rows,
        current_page: Number(meta['current_page'] ?? 1),
        last_page: Number(meta['last_page'] ?? 1),
        per_page: Number(meta['per_page'] ?? 25),
        from: (meta['from'] as number | null) ?? null,
        to: (meta['to'] as number | null) ?? null,
        total: Number(meta['total'] ?? rows.length),
        meta,
      };
    }

    return {
      data: rows,
      current_page: Number(root['current_page'] ?? 1),
      last_page: Number(root['last_page'] ?? 1),
      per_page: Number(root['per_page'] ?? 25),
      from: (root['from'] as number | null) ?? null,
      to: (root['to'] as number | null) ?? null,
      total: Number(root['total'] ?? rows.length),
    };
  }

  listBankAccounts(page: number = 1, perPage: number = 25): Observable<PaginatedBankAccountsResponse> {
    const params = new HttpParams().set('page', page).set('per_page', perPage);
    return this.http
      .get<unknown>(`${environment.apiBaseUrl}/api/admin/bank-accounts`, {
        headers: this.authHeaders(),
        params,
      })
      .pipe(map((body) => this.normalizeListResponse(body, page, perPage)));
  }

  getBankAccount(id: number): Observable<BankAccount> {
    return this.http.get<BankAccount>(
      `${environment.apiBaseUrl}/api/admin/bank-accounts/${id}`,
      { headers: this.authHeaders() },
    );
  }

  createBankAccount(formData: FormData): Observable<BankAccount> {
    return this.http.post<BankAccount>(
      `${environment.apiBaseUrl}/api/admin/bank-accounts`,
      formData,
      { headers: this.authHeaders() },
    );
  }

  updateBankAccount(id: number, formData: FormData): Observable<BankAccount> {
    return this.http.put<BankAccount>(
      `${environment.apiBaseUrl}/api/admin/bank-accounts/${id}`,
      formData,
      { headers: this.authHeaders() },
    );
  }

  /** Alternativa POST si el hosting bloquea PUT con multipart (misma ruta que en API). */
  updateBankAccountPost(id: number, formData: FormData): Observable<BankAccount> {
    return this.http.post<BankAccount>(
      `${environment.apiBaseUrl}/api/admin/bank-accounts/${id}`,
      formData,
      { headers: this.authHeaders() },
    );
  }

  deleteBankAccount(id: number): Observable<unknown> {
    return this.http.delete(`${environment.apiBaseUrl}/api/admin/bank-accounts/${id}`, {
      headers: this.authHeaders(),
    });
  }
}
