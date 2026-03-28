import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { LoginRequest } from '../models/login-request.model';
import { LoginResponse, LoginUser } from '../models/login-response.model';

export interface ForgotPasswordRequest {
  email: string;
}

export interface ForgotPasswordResponse {
  message: string;
  [key: string]: unknown;
}

export interface ResetPasswordRequest {
  email: string;
  otp: string;
  password: string;
  password_confirmation: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  password: string;
  password_confirmation: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly storageKey = 'rifasluxury_auth';

  private extractToken(value: unknown, depth: number = 0): string | null {
    if (!value || depth > 3) return null;

    if (typeof value === 'string') {
      return value.length ? value : null;
    }

    if (typeof value !== 'object') return null;

    const obj = value as Record<string, unknown>;
    const keys = ['token', 'access', 'access_token', 'jwt', 'accessToken', 'accessTokenJwt'];

    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.length) return v;
    }

    // Common wrappers used by APIs
    const wrappers = ['data', 'result', 'payload', 'response'];
    for (const w of wrappers) {
      const v = obj[w];
      const t = this.extractToken(v, depth + 1);
      if (t) return t;
    }

    return null;
  }

  constructor(
    private readonly http: HttpClient,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {}

  login(payload: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${environment.apiBaseUrl}/api/auth/login`,
      payload,
    );
  }

  forgotPassword(payload: ForgotPasswordRequest): Observable<ForgotPasswordResponse> {
    return this.http.post<ForgotPasswordResponse>(
      `${environment.apiBaseUrl}/api/auth/forgot-password`,
      payload,
    );
  }

  resetPassword(payload: ResetPasswordRequest): Observable<unknown> {
    return this.http.post(
      `${environment.apiBaseUrl}/api/auth/reset-password`,
      payload,
    );
  }

  logout(): Observable<unknown> {
    // JWT is stateless; server may still accept this for auditing.
    return this.http.post(`${environment.apiBaseUrl}/api/auth/logout`, {});
  }

  /** POST /api/auth/change-password — usuario autenticado (Bearer). */
  changePassword(payload: ChangePasswordRequest): Observable<unknown> {
    const token = this.getToken();
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : undefined;
    return this.http.post(`${environment.apiBaseUrl}/api/auth/change-password`, payload, {
      headers,
    });
  }

  saveAuth(response: LoginResponse, remember: boolean = true): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const token = this.extractToken(response);

    const session = token ? { token, raw: response } : { raw: response };
    // Remember=true -> persist across browser restarts. Otherwise, keep for current tab/session.
    if (remember) {
      localStorage.setItem(this.storageKey, JSON.stringify(session));
      sessionStorage.removeItem(this.storageKey);
    } else {
      sessionStorage.setItem(this.storageKey, JSON.stringify(session));
      localStorage.removeItem(this.storageKey);
    }
  }

  getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const raw =
      localStorage.getItem(this.storageKey) ??
      sessionStorage.getItem(this.storageKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as { token?: string };
      return parsed.token ?? null;
    } catch {
      return null;
    }
  }

  /** Usuario guardado en la última respuesta de login (`user` en el JSON del API). */
  getSessionUser(): LoginUser | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const raw =
      localStorage.getItem(this.storageKey) ??
      sessionStorage.getItem(this.storageKey);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as { raw?: LoginResponse };
      const u = parsed.raw?.user;
      if (!u || typeof u !== 'object') return null;
      return u as LoginUser;
    } catch {
      return null;
    }
  }

  clearSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(this.storageKey);
    sessionStorage.removeItem(this.storageKey);
  }
}

