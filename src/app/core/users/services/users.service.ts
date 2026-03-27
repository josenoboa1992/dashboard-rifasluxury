import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface User {
  id: number;
  name: string;
  cedula: string | null;
  phone: string | null;
  role: string;
  profile_image_id: number | null;
  email: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
  profile_image: unknown | null;
}

export interface PaginatedUsersResponse {
  current_page: number;
  data: User[];
  first_page_url: string;
  from: number | null;
  last_page: number;
  last_page_url: string;
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number | null;
  total: number;
  [key: string]: unknown;
}

export interface UserPayload {
  name: string;
  cedula: string | null;
  phone: string | null;
  role: string;
  profile_image_id: number | null;
  email: string;
  password?: string;
}

@Injectable({ providedIn: 'root' })
export class UsersService {
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

  listUsers(page: number = 1, perPage: number = 15): Observable<PaginatedUsersResponse> {
    const params = new HttpParams()
      .set('page', page)
      .set('per_page', perPage);
    return this.http.get<PaginatedUsersResponse>(
      `${environment.apiBaseUrl}/api/users`,
      { headers: this.authHeaders(), params },
    );
  }

  createUser(payload: UserPayload): Observable<User> {
    return this.http.post<User>(
      `${environment.apiBaseUrl}/api/users`,
      payload,
      { headers: this.authHeaders() },
    );
  }

  getUser(userId: number): Observable<User> {
    return this.http.get<User>(
      `${environment.apiBaseUrl}/api/users/${userId}`,
      { headers: this.authHeaders() },
    );
  }

  updateUser(userId: number, payload: Partial<UserPayload>): Observable<User> {
    return this.http.patch<User>(
      `${environment.apiBaseUrl}/api/users/${userId}`,
      payload,
      { headers: this.authHeaders() },
    );
  }

  deleteUser(userId: number): Observable<unknown> {
    return this.http.delete(
      `${environment.apiBaseUrl}/api/users/${userId}`,
      { headers: this.authHeaders() },
    );
  }
}

