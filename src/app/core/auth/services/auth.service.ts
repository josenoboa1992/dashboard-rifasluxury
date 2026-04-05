import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { LoginRequest } from '../models/login-request.model';
import { LoginResponse, LoginUser } from '../models/login-response.model';
import { StoredAuthSession } from '../models/stored-auth-session.model';

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
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

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
    private readonly router: Router,
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

  /**
   * POST /api/auth/logout (Bearer).
   * Servidor: si SESSION_DRIVER=database, limpia filas en `sessions` para ese user_id;
   * luego rota/invalida la sesión JWT como antes. Con driver file/redis no toca la tabla.
   * Rutas API solo Bearer suelen no tener filas en `sessions`; web+sesión sí.
   *
   * Debe enviar el token aunque el cliente lo considere “casi expirado”, para que el API
   * identifique al usuario y marque `session_active` / rote JWT correctamente.
   */
  logout(): Observable<unknown> {
    const token = this.peekStoredAccessToken();
    const headers = token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
    return this.http.post(`${environment.apiBaseUrl}/api/auth/logout`, {}, { headers });
  }

  /**
   * Token guardado sin validar expiración (solo para operaciones como logout).
   */
  peekStoredAccessToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    const s = this.readStoredSession();
    const t = s?.token;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
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
    const expiresAt = this.computeExpiresAtMs(response, token);

    const session: StoredAuthSession = token
      ? { token, raw: response, ...(expiresAt != null ? { expiresAt } : {}) }
      : { raw: response };

    if (remember) {
      localStorage.setItem(this.storageKey, JSON.stringify(session));
      sessionStorage.removeItem(this.storageKey);
    } else {
      sessionStorage.setItem(this.storageKey, JSON.stringify(session));
      localStorage.removeItem(this.storageKey);
    }

    this.scheduleExpiryLogout();
  }

  /**
   * Llamar una vez en el cliente al arrancar la app: programa cierre automático
   * y limpia sesión si el token ya expiró.
   */
  initSessionExpiryHandling(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const stored = this.readStoredSession();
    if (!stored?.token) {
      this.clearExpiryTimer();
      return;
    }

    if (this.sessionIsExpired(stored)) {
      this.clearSessionAndRedirectToLogin();
      return;
    }

    this.scheduleExpiryLogout(stored);
  }

  getToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const stored = this.readStoredSession();
    if (!stored) return null;

    if (this.sessionIsExpired(stored)) {
      this.clearSession();
      return null;
    }

    return stored.token ?? null;
  }

  /** Usuario guardado en la última respuesta de login (`user` en el JSON del API). */
  getSessionUser(): LoginUser | null {
    if (!isPlatformBrowser(this.platformId)) return null;

    const stored = this.readStoredSession();
    if (!stored) return null;

    if (this.sessionIsExpired(stored)) {
      this.clearSession();
      return null;
    }

    const u = stored.raw?.user;
    if (!u || typeof u !== 'object') return null;
    return u as LoginUser;
  }

  clearSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.clearExpiryTimer();
    localStorage.removeItem(this.storageKey);
    sessionStorage.removeItem(this.storageKey);
  }

  private readStoredSession(): StoredAuthSession | null {
    const raw =
      localStorage.getItem(this.storageKey) ?? sessionStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuthSession;
    } catch {
      return null;
    }
  }

  /** Prioridad: `expires_at` (API) > `expires_in` > claim `exp` del JWT. */
  private computeExpiresAtMs(response: LoginResponse, token: string | null): number | null {
    const expAt = response.expires_at;
    if (typeof expAt === 'string' && expAt.trim()) {
      const ms = Date.parse(expAt);
      if (!Number.isNaN(ms)) return ms;
    }

    const expIn = response.expires_in;
    if (typeof expIn === 'number' && Number.isFinite(expIn) && expIn > 0) {
      return Date.now() + expIn * 1000;
    }

    if (token) {
      return this.parseJwtExpMs(token);
    }

    return null;
  }

  /** `exp` en segundos desde epoch → ms. */
  private parseJwtExpMs(token: string): number | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4;
      if (pad) base64 += '='.repeat(4 - pad);
      const payload = JSON.parse(atob(base64)) as { exp?: number };
      if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
        return payload.exp * 1000;
      }
      return null;
    } catch {
      return null;
    }
  }

  private sessionIsExpired(stored: StoredAuthSession): boolean {
    if (stored.expiresAt != null && Number.isFinite(stored.expiresAt)) {
      return Date.now() >= stored.expiresAt;
    }
    if (stored.token) {
      const jwtMs = this.parseJwtExpMs(stored.token);
      if (jwtMs != null) return Date.now() >= jwtMs;
    }
    return false;
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer != null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private scheduleExpiryLogout(stored?: StoredAuthSession | null): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.clearExpiryTimer();

    const s = stored ?? this.readStoredSession();
    if (!s?.token) return;

    let expMs: number | null =
      s.expiresAt != null && Number.isFinite(s.expiresAt) ? s.expiresAt : null;
    if (expMs == null && s.token) {
      expMs = this.parseJwtExpMs(s.token);
    }
    if (expMs == null) return;

    const ms = expMs - Date.now();
    if (ms <= 0) {
      this.clearSessionAndRedirectToLogin();
      return;
    }

    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.clearSessionAndRedirectToLogin();
    }, ms);
  }

  private clearSessionAndRedirectToLogin(): void {
    this.clearSession();
    this.router
      .navigate(['/login'], { queryParams: { expired: '1' } })
      .catch(() => {});
  }
}
