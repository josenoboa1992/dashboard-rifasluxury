import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

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

  listBankAccounts(page: number = 1, perPage: number = 25): Observable<PaginatedBankAccountsResponse> {
    const params = new HttpParams().set('page', page).set('per_page', perPage);
    return this.http.get<PaginatedBankAccountsResponse>(
      `${environment.apiBaseUrl}/api/admin/bank-accounts`,
      { headers: this.authHeaders(), params },
    );
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
