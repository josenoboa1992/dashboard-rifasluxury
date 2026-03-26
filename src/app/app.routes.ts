import { Routes } from '@angular/router';

import {
  authRequiredGuard,
  publicOnlyGuard,
} from './core/auth/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'dashboard',
    canActivate: [authRequiredGuard],
    loadChildren: () =>
      import('./feature/dashboard/dashboard.module').then((m) => m.DashboardModule),
  },
  {
    path: 'login',
    canActivate: [publicOnlyGuard],
    loadChildren: () =>
      import('./feature/auth/login/login.module').then((m) => m.LoginModule),
  },
  {
    path: 'forgot-password',
    canActivate: [publicOnlyGuard],
    loadChildren: () =>
      import('./feature/auth/forgot-password/forgot-password.module').then(
        (m) => m.ForgotPasswordModule,
      ),
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];
