import { inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';

import { AuthService } from '../services/auth.service';

function redirectToLogin(state: RouterStateSnapshot, router: Router): UrlTree {
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
}

export const authRequiredGuard: CanActivateFn = (
  _route,
  state,
): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  // If SSR, localStorage isn't available; don't hard-block prerender.
  if (!isPlatformBrowser(platformId)) return true;

  return auth.getToken() ? true : redirectToLogin(state, router);
};

export const publicOnlyGuard: CanActivateFn = (
  _route,
  state,
): boolean | UrlTree => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const platformId = inject(PLATFORM_ID);

  if (!isPlatformBrowser(platformId)) return true;

  if (auth.getToken()) {
    // Already authenticated -> go to private area.
    return router.createUrlTree(['/dashboard'], {
      queryParams: { returnUrl: state.url },
    });
  }

  return true;
};

