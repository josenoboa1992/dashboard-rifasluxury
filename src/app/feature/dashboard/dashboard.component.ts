import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, HostListener, Inject, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, finalize, map, mergeMap, switchMap } from 'rxjs/operators';

import { LoginUser } from '../../core/auth/models/login-response.model';
import { orderStatusLabelEs, roleLabelEs } from '../../core/helpers/ui-labels.es';
import { AuthService } from '../../core/auth/services/auth.service';
import {
  Order,
  OrdersService,
  PaginatedOrdersResponse,
  ordersFlatFromPaginatedResponse,
} from '../../core/orders/services/orders.service';
import { PaginatedParticipantsResponse, ParticipantsService } from '../../core/participants/services/participants.service';
import { Raffle, RafflesService } from '../../core/raffles/services/raffles.service';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ThemeService } from '../../core/ui/theme/theme.service';
import { ToastService } from '../../core/ui/toast/toast.service';
import { ParticipantsComponent } from '../../feature/participants/participants.component';
import { UsersComponent } from '../../feature/users/users.component';
import { CategoriesComponent } from '../../feature/categories/categories.component';
import { RafflesComponent } from '../../feature/raffles/raffles.component';
import { BankAccountsComponent } from '../../feature/bank-accounts/bank-accounts.component';
import { OrdersComponent } from '../../feature/orders/orders.component';
import { WinnersComponent } from '../../feature/winners/winners.component';
import { PlayedNumbersComponent } from '../../feature/played-numbers/played-numbers.component';
import { RafflePrizesComponent } from '../../feature/raffle-prizes/raffle-prizes.component';
import { ClientConsultationComponent } from '../../feature/client-consultation/client-consultation.component';
import { BlockedIpsComponent } from '../../feature/blocked-ips/blocked-ips.component';
import type { UpdateSessionListItem } from '../../core/update-sessions/models/update-session.model';
import { UpdateSessionsService } from '../../core/update-sessions/services/update-sessions.service';
import { UpdateSessionDetailComponent } from '../../feature/update-session-detail/update-session-detail.component';
import { UpdateSessionsManageComponent } from '../../feature/update-sessions-manage/update-sessions-manage.component';
import { UpdatesComponent } from '../../feature/updates/updates.component';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReactiveFormsModule,
    FormatDateTimePipe,
    SpinnerComponent,
    MatCardModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    UsersComponent,
    ParticipantsComponent,
    CategoriesComponent,
    RafflesComponent,
    BankAccountsComponent,
    OrdersComponent,
    WinnersComponent,
    PlayedNumbersComponent,
    RafflePrizesComponent,
    ClientConsultationComponent,
    BlockedIpsComponent,
    UpdatesComponent,
    UpdateSessionsManageComponent,
    UpdateSessionDetailComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
  private static passwordsMatchValidator(group: AbstractControl): ValidationErrors | null {
    const pass = String(group.get('password')?.value ?? '');
    const conf = String(group.get('password_confirmation')?.value ?? '');
    if (!conf.length) return null;
    return pass === conf ? null : { passwordMismatch: true };
  }

  private static readonly URL_VIEWS = new Set([
    'users',
    'participants',
    'categories',
    'raffles',
    'bank-accounts',
    'orders',
    'winners',
    'numbers',
    'prizes',
    'consulta',
    'blocked-ips',
    'updates',
    'update-sessions-manage',
  ]);

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  readonly themeService = inject(ThemeService);
  private readonly ordersService = inject(OrdersService);
  private readonly rafflesService = inject(RafflesService);
  private readonly participantsService = inject(ParticipantsService);
  /** Actualizaciones publicadas (campana, lista y detalle). */
  readonly updateSessionsService = inject(UpdateSessionsService);

  readonly currentView = signal<
    | 'dashboard'
    | 'users'
    | 'participants'
    | 'categories'
    | 'raffles'
    | 'bank-accounts'
    | 'orders'
    | 'winners'
    | 'numbers'
    | 'prizes'
    | 'consulta'
    | 'blocked-ips'
    | 'updates'
    | 'update-detail'
    | 'update-sessions-manage'
  >('dashboard');
  readonly sidebarCollapsed = signal(false);
  /** Coincide con el breakpoint CSS (max-width: 899px): drawer móvil. */
  readonly isMobileLayout = signal(false);
  readonly mobileNavOpen = signal(false);
  readonly logoutOpen = signal(false);
  readonly changePasswordOpen = signal(false);
  readonly userMenuOpen = signal(false);
  /** Panel desplegable de la campana (lista reciente). */
  readonly notificationsOpen = signal(false);
  readonly bellListLoading = signal(false);
  readonly bellItems = signal<UpdateSessionListItem[]>([]);
  /** Id de la sesión en `view=update-detail` (query `updateId`). */
  readonly updateDetailSessionId = signal<number | null>(null);

  /** Perfil del login guardado en sesión (`user` del API). */
  readonly sessionUser = signal<LoginUser | null>(null);

  readonly statsLoading = signal(false);
  readonly statsError = signal<string | null>(null);
  readonly pendingOrdersTotal = signal(0);
  readonly availableRafflesCount = signal(0);
  readonly participantsTotal = signal(0);
  /** Total de pedidos con `status=confirmed` (GET /api/admin/orders?status=confirmed). */
  readonly confirmedOrdersTotal = signal(0);
  /** Total de pedidos con `status=cancelled`. */
  readonly cancelledOrdersTotal = signal(0);
  readonly recentOrders = signal<Order[]>([]);

  /** Series para el gráfico de columnas (confirmadas / canceladas / pendientes). */
  readonly ordersChartItems = computed(() => {
    const confirmed = this.confirmedOrdersTotal();
    const cancelled = this.cancelledOrdersTotal();
    const pending = this.pendingOrdersTotal();
    const max = Math.max(confirmed, cancelled, pending, 1);
    const pct = (v: number) => {
      if (v <= 0) return 0;
      const raw = (v / max) * 100;
      return Math.min(100, Math.max(Math.round(raw * 10) / 10, 6));
    };
    return [
      { key: 'confirmed' as const, label: 'Confirmadas', value: confirmed, pct: pct(confirmed) },
      { key: 'cancelled' as const, label: 'Canceladas', value: cancelled, pct: pct(cancelled) },
      { key: 'pending' as const, label: 'Pendientes', value: pending, pct: pct(pending) },
    ];
  });

  readonly ordersChartAriaLabel = computed(() => {
    const c = this.confirmedOrdersTotal();
    const x = this.cancelledOrdersTotal();
    const p = this.pendingOrdersTotal();
    return `Órdenes por estado: ${c} confirmadas, ${x} canceladas, ${p} pendientes`;
  });

  readonly userInitials = computed(() => {
    const name = this.sessionUser()?.name?.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/).filter((p) => p.length > 0);
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return name.slice(0, Math.min(2, name.length)).toUpperCase();
  });

  /** Solo `role === 'admin'` (insensible a mayúsculas) o `is_admin === true`. */
  readonly isAdmin = computed(() => DashboardComponent.userIsAdmin(this.sessionUser()));

  static userIsAdmin(u: LoginUser | null): boolean {
    if (!u) return false;
    if (u.is_admin === true) return true;
    const role = u.role;
    return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
  }

  /** Solo rol soporte (API `support` / `soporte`): ve «Gestionar actualizaciones». */
  static userCanManageUpdateSessions(u: LoginUser | null): boolean {
    const role = (u?.role ?? '').trim().toLowerCase();
    return role === 'support' || role === 'soporte';
  }

  readonly canManageUpdateSessions = computed(() =>
    DashboardComponent.userCanManageUpdateSessions(this.sessionUser()),
  );

  isLoggingOut = false;
  isChangePasswordSubmitting = false;

  readonly changePasswordForm = this.fb.nonNullable.group(
    {
      current_password: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8)]],
      password_confirmation: ['', Validators.required],
    },
    { validators: [DashboardComponent.passwordsMatchValidator] },
  );

  constructor(
    private readonly auth: AuthService,
    @Inject(PLATFORM_ID) private readonly platformId: object,
  ) {
    this.sessionUser.set(this.auth.getSessionUser());
    if (isPlatformBrowser(this.platformId)) {
      this.updateSessionsService.refreshUnreadCount();
    }

    if (isPlatformBrowser(this.platformId)) {
      const mq = window.matchMedia('(max-width: 899px)');
      const syncMobileLayout = () => {
        this.isMobileLayout.set(mq.matches);
        if (!mq.matches) {
          this.mobileNavOpen.set(false);
        }
      };
      syncMobileLayout();
      mq.addEventListener('change', syncMobileLayout);
    }

    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const v = params.get('view');
      if (
        (v === 'users' || v === 'blocked-ips') &&
        !DashboardComponent.userIsAdmin(this.sessionUser())
      ) {
        void this.router.navigate(['/dashboard'], { replaceUrl: true });
        return;
      }
      if (v === 'update-sessions-manage' && !DashboardComponent.userCanManageUpdateSessions(this.sessionUser())) {
        void this.router.navigate(['/dashboard'], { replaceUrl: true });
        return;
      }
      if (v === 'update-detail') {
        const raw = params.get('updateId');
        const id = raw != null ? Number(raw) : NaN;
        if (!Number.isFinite(id) || id <= 0) {
          void this.router.navigate(['/dashboard'], { queryParams: { view: 'updates' }, replaceUrl: true });
          return;
        }
        this.updateDetailSessionId.set(id);
        this.currentView.set('update-detail');
        this.closeMobileNav();
        return;
      }
      this.updateDetailSessionId.set(null);
      if (v && DashboardComponent.URL_VIEWS.has(v)) {
        this.currentView.set(
          v as
            | 'users'
            | 'participants'
            | 'categories'
            | 'raffles'
            | 'bank-accounts'
            | 'orders'
            | 'winners'
            | 'numbers'
            | 'prizes'
            | 'consulta'
            | 'blocked-ips'
            | 'updates'
            | 'update-sessions-manage',
        );
      } else {
        this.currentView.set('dashboard');
      }
      this.closeMobileNav();
      if (this.currentView() === 'dashboard') {
        this.loadDashboardStats();
      }
    });
  }

  loadDashboardStats(): void {
    this.statsLoading.set(true);
    this.statsError.set(null);

    const emptyOrders: PaginatedOrdersResponse = {
      current_page: 1,
      data: [],
      groups: [],
      from: null,
      last_page: 1,
      per_page: 1,
      to: null,
      total: 0,
    };

    const safeOrders = (status: string) =>
      this.ordersService.listOrders(1, 1, status).pipe(catchError(() => of(emptyOrders)));

    forkJoin({
      participants: this.participantsService.listParticipants(1, 1).pipe(
        catchError(() => of({ total: 0 } as PaginatedParticipantsResponse)),
      ),
      pendingVal: safeOrders('pending_validation'),
      pendingPay: safeOrders('pending_payment'),
      recentOrders: this.ordersService.listOrders(1, 8).pipe(catchError(() => of(emptyOrders))),
      raffles: this.loadAllRaffles$().pipe(catchError(() => of([] as Raffle[]))),
      confirmedOrders: this.ordersService.listOrders(1, 1, 'confirmed').pipe(
        catchError(() => of(emptyOrders)),
      ),
      cancelledOrders: safeOrders('cancelled'),
    })
      .pipe(
        map(
          ({
            participants,
            pendingVal,
            pendingPay,
            recentOrders,
            raffles,
            confirmedOrders,
            cancelledOrders,
          }) => ({
            participants,
            pendingVal,
            pendingPay,
            recentOrders,
            raffles,
            confirmedOrdersTotal: confirmedOrders.total ?? 0,
            cancelledOrdersTotal: cancelledOrders.total ?? 0,
          }),
        ),
        finalize(() => this.statsLoading.set(false)),
      )
      .subscribe({
        next: ({
          participants,
          pendingVal,
          pendingPay,
          recentOrders: recentOrdersRes,
          raffles,
          confirmedOrdersTotal,
          cancelledOrdersTotal,
        }) => {
          this.participantsTotal.set(participants.total ?? 0);
          this.pendingOrdersTotal.set((pendingVal.total ?? 0) + (pendingPay.total ?? 0));
          this.availableRafflesCount.set(DashboardComponent.countAvailableRaffles(raffles));
          this.confirmedOrdersTotal.set(confirmedOrdersTotal);
          this.cancelledOrdersTotal.set(cancelledOrdersTotal);
          this.recentOrders.set(ordersFlatFromPaginatedResponse(recentOrdersRes));
        },
        error: () => {
          this.statsError.set('No se pudieron cargar los datos del panel.');
        },
      });
  }

  private loadAllRaffles$(): Observable<Raffle[]> {
    const perPage = 100;
    return this.rafflesService.listRaffles(1, perPage).pipe(
      switchMap((first) => {
        const last = first.last_page ?? 1;
        const batch = first.data ?? [];
        if (last <= 1) return of(batch);
        const pageNums = Array.from({ length: last - 1 }, (_, i) => i + 2);
        return forkJoin(
          pageNums.map((page) =>
            this.rafflesService.listRaffles(page, perPage).pipe(map((r) => r.data ?? [])),
          ),
        ).pipe(map((chunks) => [...batch, ...chunks.flat()]));
      }),
    );
  }

  private static countAvailableRaffles(raffles: Raffle[]): number {
    return raffles.filter((r) => DashboardComponent.isRaffleAvailable(r)).length;
  }

  private static isRaffleAvailable(r: Raffle): boolean {
    const s = (r.status || '').toLowerCase().trim();
    if (['drawn', 'completed', 'closed', 'finished', 'cancelled'].includes(s)) return false;
    const avail = r.tickets_available_count;
    if (avail === 0) return false;
    if (avail !== undefined && avail !== null && avail > 0) return true;
    return ['active', 'open', 'published', 'live', 'selling'].includes(s);
  }

  orderStatusLabel(status: string | undefined): string {
    return orderStatusLabelEs(status);
  }

  roleLabel(role: string | undefined): string {
    return roleLabelEs(role);
  }

  toggleNotificationsPanel(ev: Event): void {
    ev.stopPropagation();
    this.closeUserMenu();
    this.notificationsOpen.update((open) => {
      const next = !open;
      if (next) {
        this.loadBellList();
      }
      return next;
    });
  }

  closeNotificationsPanel(): void {
    this.notificationsOpen.set(false);
  }

  private loadBellList(): void {
    this.bellListLoading.set(true);
    this.collectUnreadBellItems(1, [])
      .pipe(finalize(() => this.bellListLoading.set(false)))
      .subscribe({
        next: (items) => this.bellItems.set(items),
        error: () => this.bellItems.set([]),
      });
  }

  /** Hasta 15 filas no leídas; avanza páginas si la primera está llena de leídas. */
  private collectUnreadBellItems(
    page: number,
    acc: UpdateSessionListItem[],
  ): Observable<UpdateSessionListItem[]> {
    return this.updateSessionsService.listPublished(page, 30).pipe(
      mergeMap((res) => {
        const pageUnread = (res.data ?? []).filter((r) => r.is_read !== true);
        const combined = [...acc, ...pageUnread];
        const capped = combined.slice(0, 15);
        const lastPage = res.last_page ?? page;
        if (capped.length >= 15 || page >= lastPage) {
          return of(capped);
        }
        return this.collectUnreadBellItems(page + 1, capped);
      }),
    );
  }

  openUpdateFromBell(id: number, ev: Event): void {
    ev.stopPropagation();
    this.closeNotificationsPanel();
    void this.router.navigate(['/dashboard'], { queryParams: { view: 'update-detail', updateId: id } });
  }

  goToAllUpdates(ev: Event): void {
    ev.stopPropagation();
    this.closeNotificationsPanel();
    this.openView('updates');
  }

  orderTimelineDotClass(status: string | undefined): string {
    const s = status ?? '';
    if (s === 'pending_validation') return 'tl-dot warn';
    if (s === 'pending_payment') return 'tl-dot alert';
    if (s === 'confirmed') return 'tl-dot ok';
    if (s === 'cancelled') return 'tl-dot muted';
    return 'tl-dot';
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  toggleSidebar(): void {
    if (this.isMobileLayout()) {
      this.mobileNavOpen.update((open) => {
        if (!open) {
          this.closeUserMenu();
        }
        return !open;
      });
    } else {
      this.sidebarCollapsed.update((v) => !v);
    }
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((wasOpen) => {
      const willOpen = !wasOpen;
      if (willOpen) {
        this.closeMobileNav();
      }
      return willOpen;
    });
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  openView(
    view:
      | 'dashboard'
      | 'users'
      | 'participants'
      | 'categories'
      | 'raffles'
      | 'bank-accounts'
      | 'orders'
      | 'winners'
      | 'numbers'
      | 'prizes'
      | 'consulta'
      | 'blocked-ips'
      | 'updates'
      | 'update-sessions-manage',
    ordersQuery?: number | { raffleId?: number; orderId?: number },
  ): void {
    if (
      (view === 'users' || view === 'blocked-ips') &&
      !DashboardComponent.userIsAdmin(this.sessionUser())
    ) {
      view = 'dashboard';
    }
    if (view === 'update-sessions-manage' && !DashboardComponent.userCanManageUpdateSessions(this.sessionUser())) {
      view = 'dashboard';
    }
    this.closeNotificationsPanel();
    this.currentView.set(view);
    if (view === 'dashboard') {
      void this.router.navigate(['/dashboard'], { replaceUrl: true });
    } else {
      const queryParams: Record<string, string | number> = { view };
      if (view === 'orders' && ordersQuery != null) {
        if (typeof ordersQuery === 'number') {
          const oid = Math.floor(ordersQuery);
          if (Number.isFinite(oid) && oid > 0) {
            queryParams['orderId'] = oid;
          }
        } else {
          const rid = Number(ordersQuery.raffleId);
          if (Number.isFinite(rid) && rid > 0) {
            queryParams['raffle_id'] = Math.floor(rid);
          }
          const oid = Number(ordersQuery.orderId);
          if (Number.isFinite(oid) && oid > 0) {
            queryParams['orderId'] = Math.floor(oid);
          }
        }
      }
      void this.router.navigate(['/dashboard'], {
        queryParams,
        replaceUrl: true,
      });
    }
  }

  /** Órdenes recientes → `/dashboard?view=orders&raffle_id=…&orderId=…` */
  openRecentOrder(order: Order): void {
    const rid = Number(order.raffle_id);
    const oid = Number(order.id);
    const q: { raffleId?: number; orderId?: number } = {};
    if (Number.isFinite(rid) && rid > 0) q.raffleId = Math.floor(rid);
    if (Number.isFinite(oid) && oid > 0) q.orderId = Math.floor(oid);
    this.openView('orders', q);
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.notificationsOpen()) {
      this.closeNotificationsPanel();
      return;
    }
    if (this.changePasswordOpen()) {
      this.closeChangePasswordModal();
      return;
    }
    if (this.logoutOpen()) {
      this.closeLogoutModal();
      return;
    }
    if (this.mobileNavOpen()) {
      this.closeMobileNav();
      return;
    }
    this.closeUserMenu();
  }

  @HostListener('document:click')
  onDocClick(): void {
    this.closeUserMenu();
    this.closeMobileNav();
    this.closeNotificationsPanel();
  }

  openChangePasswordModal(): void {
    this.closeUserMenu();
    this.changePasswordForm.reset({
      current_password: '',
      password: '',
      password_confirmation: '',
    });
    this.changePasswordOpen.set(true);
  }

  closeChangePasswordModal(): void {
    this.changePasswordOpen.set(false);
    this.changePasswordForm.reset({
      current_password: '',
      password: '',
      password_confirmation: '',
    });
  }

  submitChangePassword(): void {
    if (this.isChangePasswordSubmitting) return;
    this.changePasswordForm.markAllAsTouched();
    if (this.changePasswordForm.invalid) return;

    const { current_password, password, password_confirmation } = this.changePasswordForm.getRawValue();
    this.isChangePasswordSubmitting = true;
    this.auth
      .changePassword({ current_password, password, password_confirmation })
      .pipe(finalize(() => (this.isChangePasswordSubmitting = false)))
      .subscribe({
        next: () => {
          this.toast.success('Contraseña actualizada.');
          this.closeChangePasswordModal();
        },
        error: (err: unknown) => {
          this.toast.error(this.readChangePasswordApiError(err));
        },
      });
  }

  private readChangePasswordApiError(err: unknown): string {
    const e = err as { error?: unknown };
    const body = e?.error;
    if (body && typeof body === 'object') {
      const o = body as Record<string, unknown>;
      const msg = o['message'];
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
      const errors = o['errors'];
      if (errors && typeof errors === 'object') {
        for (const v of Object.values(errors as Record<string, unknown>)) {
          if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return v[0];
        }
      }
    }
    return 'No se pudo cambiar la contraseña. Revisa la contraseña actual y los requisitos del nuevo acceso.';
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

