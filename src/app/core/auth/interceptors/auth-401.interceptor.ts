import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../services/auth.service';

/** Rutas de auth donde un 401 es esperado y no debe forzar cierre de sesión global. */
function isAuthRouteExemptFromSessionRedirect(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes('/api/auth/login') ||
    u.includes('/api/auth/forgot-password') ||
    u.includes('/api/auth/reset-password') ||
    u.includes('/api/auth/logout')
  );
}

/**
 * Si el API responde 401 en rutas protegidas, la sesión local ya no es válida:
 * limpia storage y envía al login (alineado con rotación JWT en servidor).
 */
export const auth401Interceptor: HttpInterceptorFn = (req, next) => {
  const platformId = inject(PLATFORM_ID);
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!isPlatformBrowser(platformId)) {
    return next(req);
  }

  const base = environment.apiBaseUrl.replace(/\/$/, '');
  if (!req.url.startsWith(base)) {
    return next(req);
  }

  if (isAuthRouteExemptFromSessionRedirect(req.url)) {
    return next(req);
  }

  return next(req).pipe(
    catchError((err: unknown) => {
      const httpErr = err as HttpErrorResponse;
      if (httpErr.status !== 401) {
        return throwError(() => err);
      }

      const onLogin = router.url.split('?')[0] === '/login';
      if (onLogin) {
        return throwError(() => err);
      }

      auth.clearSession();
      router.navigate(['/login'], { queryParams: { expired: '1' } }).catch(() => {});

      return throwError(() => err);
    }),
  );
};
