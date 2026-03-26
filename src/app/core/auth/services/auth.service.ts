import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { LoginRequest } from '../models/login-request.model';
import { LoginResponse } from '../models/login-response.model';

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

  logout(): Observable<unknown> {
    // JWT is stateless; server may still accept this for auditing.
    return this.http.post(`${environment.apiBaseUrl}/api/auth/logout`, {});
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

  clearSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(this.storageKey);
    sessionStorage.removeItem(this.storageKey);
  }
}

