import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface Category {
  id: number;
  name?: string;
  title?: string;
  slug?: string | null;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface PaginatedCategoriesResponse {
  current_page: number;
  data: Category[];
  from: number | null;
  last_page: number;
  per_page: number;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

export interface CategoryPayload {
  name: string;
  slug: string | null;
}

@Injectable({ providedIn: 'root' })
export class CategoriesService {
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

  listCategories(page: number = 1, perPage: number = 25): Observable<PaginatedCategoriesResponse> {
    const params = new HttpParams()
      .set('page', page)
      .set('per_page', perPage);
    return this.http.get<PaginatedCategoriesResponse>(
      `${environment.apiBaseUrl}/api/admin/categories`,
      { headers: this.authHeaders(), params },
    );
  }

  createCategory(payload: CategoryPayload): Observable<Category> {
    return this.http.post<Category>(
      `${environment.apiBaseUrl}/api/admin/categories`,
      payload,
      { headers: this.authHeaders() },
    );
  }

  getCategory(categoryId: number): Observable<Category> {
    return this.http.get<Category>(
      `${environment.apiBaseUrl}/api/admin/categories/${categoryId}`,
      { headers: this.authHeaders() },
    );
  }

  updateCategory(categoryId: number, payload: Partial<CategoryPayload>): Observable<Category> {
    return this.http.patch<Category>(
      `${environment.apiBaseUrl}/api/admin/categories/${categoryId}`,
      payload,
      { headers: this.authHeaders() },
    );
  }

  deleteCategory(categoryId: number): Observable<unknown> {
    return this.http.delete(
      `${environment.apiBaseUrl}/api/admin/categories/${categoryId}`,
      { headers: this.authHeaders() },
    );
  }
}

