import { Component, HostListener, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../core/auth/services/auth.service';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, SpinnerComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  readonly sidebarCollapsed = signal(false);
  readonly logoutOpen = signal(false);
  readonly userMenuOpen = signal(false);
  isLoggingOut = false;

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((v) => !v);
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    this.closeUserMenu();
  }

  @HostListener('document:click')
  onDocClick(): void {
    this.closeUserMenu();
  }

  openLogoutModal(): void {
    this.closeUserMenu();
    this.logoutOpen.set(true);
  }

  closeLogoutModal(): void {
    this.logoutOpen.set(false);
  }

  confirmLogout(): void {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;

    this.auth
      .logout()
      .pipe(
        finalize(() => {
          this.isLoggingOut = false;
        }),
      )
      .subscribe({
        next: () => {
          this.auth.clearSession();
          this.logoutOpen.set(false);
          this.router.navigateByUrl('/login');
        },
        error: () => {
          // Even if the server returns 401, clear client session (JWT stateless).
          this.auth.clearSession();
          this.logoutOpen.set(false);
          this.router.navigateByUrl('/login');
        },
      });
  }
}

