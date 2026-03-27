import { Component, HostListener, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../core/auth/services/auth.service';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ParticipantsComponent } from '../../feature/participants/participants.component';
import { UsersComponent } from '../../feature/users/users.component';
import { CategoriesComponent } from '../../feature/categories/categories.component';
import { RafflesComponent } from '../../feature/raffles/raffles.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink, SpinnerComponent, UsersComponent, ParticipantsComponent, CategoriesComponent, RafflesComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  readonly currentView = signal<'dashboard' | 'users' | 'participants' | 'categories' | 'raffles'>('dashboard');
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

  openView(view: 'dashboard' | 'users' | 'participants' | 'categories' | 'raffles'): void {
    this.currentView.set(view);
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

