import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { EMPTY, from, merge, of, Subject } from 'rxjs';
import type { Observable } from 'rxjs';
import {
  catchError,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  take,
  tap,
  toArray,
} from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { LoginUser } from '../../core/auth/models/login-response.model';
import { AuthService } from '../../core/auth/services/auth.service';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { orderStatusLabelEs, raffleStatusLabelEs } from '../../core/helpers/ui-labels.es';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { FormatMoneyPipe } from '../../core/pipes/format-money.pipe';
import { formatDateTimeDisplay } from '../../core/helpers/date-format.helper';
import { formatMoneyDop } from '../../core/helpers/money-format.helper';
import { ChartsService } from '../../core/charts/services/charts.service';
import { Raffle, RafflesService } from '../../core/raffles/services/raffles.service';
import {
  BulkOrderDeleteSkipped,
  mergeOrderPages,
  Order,
  ORDERS_BULK_DELETE_MAX_IDS,
  ordersFlatFromPaginatedResponse,
  OrdersService,
} from '../../core/orders/services/orders.service';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DecimalPipe,
    SpinnerComponent,
    ConfirmDialogComponent,
    FormatDateTimePipe,
    FormatMoneyPipe,
    ClipboardModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSlideToggleModule,
  ],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css',
})
export class OrdersComponent implements OnInit {
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  /** Pedidos cargados (lista plana; el banco va en `order.bank_name`). */
  readonly orderList = signal<Order[]>([]);
  readonly searchTerm = signal('');
  /** Filtro enviado al API (`''` = todos). */
  readonly statusFilter = signal('');
  /** Filtro por rifa (`?raffle_id=` en la URL). */
  readonly filterRaffleId = signal<number | null>(null);
  /** Título de la rifa del filtro (GET admin) para el cartel. */
  readonly raffleFilterTitle = signal<string | null>(null);
  readonly raffleFilterTitleLoading = signal(false);
  /** Paso 1: listado de rifas para elegir antes de cargar pedidos. */
  readonly pickerRaffles = signal<Raffle[]>([]);
  readonly pickerLoading = signal(false);
  readonly pickerError = signal<string | null>(null);
  readonly pickerSearchTerm = signal('');
  readonly pickerStatusFilter = signal('');
  readonly pickerCurrentPage = signal(1);
  readonly pickerLastPage = signal(1);
  readonly pickerPerPage = signal(25);
  readonly pickerTotal = signal(0);
  readonly pickerFromItem = signal(0);
  readonly pickerToItem = signal(0);
  readonly lastLoadedPage = signal(0);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly total = signal(0);

  /** Carga del chart + badges de pestañas (filtrado por `filterRaffleId` cuando hay rifa). */
  readonly statusCountsLoading = signal(false);
  /** Total de pedidos desde `/api/admin/charts/orders-distribution` (por rifa o agregado). */
  readonly totalOrders = signal(0);
  /** Conteos de ÓRDENES (para badges de pestañas). */
  readonly pendingOrders = signal(0);
  readonly confirmedOrders = signal(0);
  readonly cancelledOrders = signal(0);

  /** Denominador del donut: tickets pendientes + tickets confirmados + available (sin cancelados). */
  readonly chartDonutGrand = signal(0);
  /** Tickets en estado pendiente (Revisando) para el gráfico. */
  readonly countRevisando = signal(0);
  /** Tickets en estado confirmado (Pagado) para el gráfico. */
  readonly countPagado = signal(0);
  /** Cupo disponible (en la rifa filtrada o agregado según el API). */
  readonly availableTickets = signal(0);
  /** Evita “parpadeo” vacío mientras llega el primer payload del chart. */
  readonly chartInsightsLoaded = signal(false);

  /** Skeleton del bloque Distribución + Filtro hasta el primer `ordersDistribution`. */
  readonly chartInsightsSkeletonVisible = computed(
    () => this.statusCountsLoading() && !this.chartInsightsLoaded(),
  );

  // ── Bloqueo de órdenes públicas ──────────────────────────────
  /** Estado actual del bloqueo (toggle). */
  readonly ordersBlocked = signal(false);
  /** Cargando el estado del bloqueo. */
  readonly ordersBlockLoading = signal(false);
  /** Guardando el cambio de bloqueo. */
  readonly ordersBlockSaving = signal(false);

  readonly hasMore = computed(() => this.lastLoadedPage() < this.lastPage());

  /** Pestañas de filtro: valor vacío = todos. */
  static readonly STATUS_TABS: ReadonlyArray<{ filterValue: string; label: string }> = [
    { filterValue: '', label: 'Todos' },
    { filterValue: 'pending_validation', label: 'Revisando' },
    { filterValue: 'confirmed', label: 'Pagado' },
    { filterValue: 'cancelled', label: 'Cancelado' },
  ] as const;

  readonly statusTabs = OrdersComponent.STATUS_TABS;

  readonly chartLegend = computed(() => {
    const grand = this.chartDonutGrand();
    if (grand <= 0) return [];
    // Leyenda: solo pedidos (revisando/pagado). El cupo disponible se refleja en el donut,
    // pero no en la lista para evitar solapes con porcentajes muy altos.
    const list = [
      { key: 'revisando', label: 'Tickes Pendientes', n: this.countRevisando(), color: '#ea580c' },
      { key: 'pagado', label: 'Tickes Pagados', n: this.countPagado(), color: '#16a34a' },
    ];
    return list.filter((r) => r.n > 0);
  });

  readonly chartDonutGradient = computed(() => {
    const grand = this.chartDonutGrand();
    if (grand <= 0) return '#e8eaef';
    const slices: { color: string; frac: number }[] = [];
    const add = (n: number, color: string) => {
      if (n > 0) slices.push({ color, frac: n / grand });
    };
    add(this.countRevisando(), '#ea580c');
    add(this.countPagado(), '#16a34a');
    add(this.availableTickets(), '#94a3b8');
    const sumFrac = slices.reduce((s, x) => s + x.frac, 0);
    if (sumFrac < 1 - 1e-9) {
      slices.push({ color: '#cbd5e1', frac: Math.max(0, 1 - sumFrac) });
    }
    let acc = 0;
    const parts: string[] = [];
    for (const s of slices) {
      const start = acc * 360;
      acc += s.frac;
      const end = acc * 360;
      parts.push(`${s.color} ${start}deg ${end}deg`);
    }
    return `conic-gradient(${parts.join(', ')})`;
  });

  readonly chartAriaLabel = computed(() => {
    const grand = this.chartDonutGrand();
    if (grand <= 0) return 'Sin datos de distribución';
    const revisando = this.countRevisando();
    const pagado = this.countPagado();
    const disponible = this.availableTickets();
    const parts: string[] = [];
    if (revisando > 0) parts.push(`Revisando ${revisando} tickets`);
    if (pagado > 0) parts.push(`Pagado ${pagado} tickets`);
    if (disponible > 0) parts.push(`Disponible ${disponible} tickets`);
    return parts.length ? `Distribución: ${parts.join(', ')}` : 'Sin datos de distribución';
  });

  readonly detailOpen = signal(false);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly orderDetail = signal<Order | null>(null);
  readonly reviewing = signal(false);

  readonly rejectConfirmOpen = signal(false);

  /** Pedido seleccionado para eliminar (listado); si es null, se usa `orderDetail()` en el modal. */
  readonly orderPendingDelete = signal<Order | null>(null);
  readonly deleteConfirmOpen = signal(false);
  readonly deleting = signal(false);

  /** IDs seleccionados para eliminación masiva (solo admin). */
  readonly selectedOrderIds = signal<readonly number[]>([]);
  readonly bulkDeleteConfirmOpen = signal(false);
  readonly bulkDeleting = signal(false);

  /** Vista previa del comprobante desde el listado (imagen o PDF en iframe). */
  readonly voucherPreviewOpen = signal(false);
  readonly voucherPreviewUrl = signal<string | null>(null);
  readonly voucherPreviewKind = signal<'image' | 'pdf' | null>(null);
  /** Mini overlay con QR del enlace al pedido (panel admin). */
  readonly ticketQrOpen = signal(false);

  private readonly fb = inject(FormBuilder);
  private readonly clipboard = inject(Clipboard);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);
  /** Invalida respuestas de append si hubo `reloadFromStart` entretanto. */
  private listRequestGeneration = 0;

  /**
   * Peticiones de “siguiente página” encoladas; `exhaustMap` asegura una sola carga activa
   * (no se mezcla otra página hasta terminar la anterior y fusionar grupos).
   */
  private readonly loadMoreRequests$ = new Subject<void>();
  /**
   * Tras mezclar bloques de banco, se bloquea un nuevo "cargar más" por scroll
   * hasta que el DOM pinta (doble rAF) y un pequeño margen (ms) para no encadenar
   * otra petición mientras aún se asienta la agrupación.
   */
  private nextOrdersScrollLoadAllowedAt = 0;
  private static readonly ORDERS_SCROLL_LOAD_COOLDOWN_MS = 320;

  readonly reviewNotes = this.fb.nonNullable.control('');

  /** Igual que en el dashboard: `role === 'admin'` o `is_admin === true`. */
  readonly sessionUser = signal<LoginUser | null>(this.auth.getSessionUser());
  readonly isAdmin = computed(() => OrdersComponent.userIsAdmin(this.sessionUser()));

  /** Todos los pedidos ya traídos del servidor (scroll infinito). */
  readonly ordersFlat = computed(() => this.orderList());

  /** Lista mostrada: coincide con lo devuelto por el API (`search` en servidor + paginación). */
  readonly visibleOrders = computed(() => this.orderList());

  /** Dispara recarga del listado tras escribir en el buscador (evita una petición por tecla). */
  private readonly orderSearchDebounce$ = new Subject<void>();

  readonly visiblePickerRaffles = computed(() => {
    const term = this.pickerSearchTerm().trim().toLowerCase();
    const rows = this.pickerRaffles();
    if (!term) return rows;
    return rows.filter((r) => {
      const hay = `${r.id} ${r.title} ${r.status} ${r.ticket_price}`.toLowerCase();
      return hay.includes(term);
    });
  });

  /** Paginación del selector (mismo criterio que en Rifas). */
  readonly pickerPageNumbers = computed(() => {
    const current = this.pickerCurrentPage();
    const last = this.pickerLastPage();
    const start = Math.max(1, current - 2);
    const end = Math.min(last, current + 2);
    const pages: number[] = [];
    for (let i = start; i <= end; i += 1) pages.push(i);
    return pages;
  });

  readonly rejectConfirmMessage = computed(() => {
    const o = this.orderDetail();
    if (!o) return '';
    const amt = formatMoneyDop(o.total_amount) || String(o.total_amount ?? '');
    return `¿Rechazar el pedido #${o.id} de ${o.customer_name} (${amt})? Los boletos asociados se liberan y el pedido queda cancelado.`;
  });

  readonly deleteConfirmMessage = computed(() => {
    const o = this.orderPendingDelete() ?? this.orderDetail();
    if (!o) return '';
    return `¿Eliminar definitivamente el pedido #${o.id} (${o.customer_name})? Esta acción no se puede deshacer.`;
  });

  readonly bulkDeleteConfirmMessage = computed(() => {
    const n = this.selectedOrderIds().length;
    if (n <= 0) return '';
    const batches = Math.ceil(n / ORDERS_BULK_DELETE_MAX_IDS);
    const batchNote =
      batches > 1
        ? ` Se enviarán ${batches} solicitudes al servidor (máximo ${ORDERS_BULK_DELETE_MAX_IDS} pedidos por solicitud).`
        : '';
    return `¿Eliminar definitivamente ${n} pedido(s) seleccionado(s)?${batchNote} Esta acción no se puede deshacer.`;
  });

  /** Estado del checkbox “seleccionar visibles”. */
  readonly selectAllVisibleState = computed<'all' | 'some' | 'none'>(() => {
    const visible = this.visibleOrders();
    if (!visible.length) return 'none';
    const sel = new Set(this.selectedOrderIds());
    let c = 0;
    for (const o of visible) {
      if (sel.has(o.id)) c += 1;
    }
    if (c === 0) return 'none';
    if (c === visible.length) return 'all';
    return 'some';
  });

  constructor(
    private readonly ordersService: OrdersService,
    private readonly chartsService: ChartsService,
    private readonly rafflesService: RafflesService,
    private readonly toast: ToastService,
    private readonly router: Router,
  ) {
    // El `ActivatedRoute` inyectado aquí no siempre refleja `/dashboard` (componente embebido); usamos la URL real del router.
    merge(
      of(null),
      this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)),
    )
      .pipe(
        map(() => this.parseOrderIdFromUrl()),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((orderId) => {
        if (orderId == null) {
          this.resetDetailPanelState();
          return;
        }
        this.loadOrderDetail(orderId);
      });

    merge(
      of(null),
      this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)),
    )
      .pipe(
        map(() => this.parseRaffleIdFromUrl()),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((raffleId) => {
        this.filterRaffleId.set(raffleId);
        this.loadRaffleFilterTitle(raffleId);
        this.refreshStatusCounts();
        if (raffleId == null) {
          this.listRequestGeneration += 1;
          this.orderList.set([]);
          this.total.set(0);
          this.lastLoadedPage.set(0);
          this.lastPage.set(1);
          this.loading.set(false);
          this.loadingMore.set(false);
          this.error.set(null);
          this.clearBulkSelection();
          this.searchTerm.set('');
          this.pickerSearchTerm.set('');
          this.pickerStatusFilter.set('');
          this.pickerCurrentPage.set(1);
          this.loadRafflesForPicker(1);
        } else {
          this.reloadFromStart();
        }
      });

    this.loadMoreRequests$
      .pipe(exhaustMap(() => this.appendNextOrdersPage$()), takeUntilDestroyed())
      .subscribe();

    this.orderSearchDebounce$
      .pipe(debounceTime(400), takeUntilDestroyed())
      .subscribe(() => {
        if (this.filterRaffleId() == null) return;
        this.reloadFromStart();
      });
  }

  private ordersApiSearch(): string | null {
    const t = this.searchTerm().trim();
    return t === '' ? null : t;
  }

  private parseOrderIdFromUrl(): number | null {
    const tree = this.router.parseUrl(this.router.url);
    const raw = tree.queryParams['orderId'];
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (s == null || s === '') return null;
    const id = Number.parseInt(String(s), 10);
    return Number.isFinite(id) && id >= 1 ? id : null;
  }

  private parseRaffleIdFromUrl(): number | null {
    const tree = this.router.parseUrl(this.router.url);
    const raw = tree.queryParams['raffle_id'];
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (s == null || s === '') return null;
    const id = Number.parseInt(String(s), 10);
    return Number.isFinite(id) && id >= 1 ? id : null;
  }

  private loadRaffleFilterTitle(raffleId: number | null): void {
    if (raffleId == null) {
      this.raffleFilterTitle.set(null);
      this.raffleFilterTitleLoading.set(false);
      return;
    }
    this.raffleFilterTitleLoading.set(true);
    this.rafflesService
      .getRaffle(raffleId)
      .pipe(
        finalize(() => this.raffleFilterTitleLoading.set(false)),
        catchError(() => of(null)),
      )
      .subscribe((r) => {
        if (r && typeof r.title === 'string' && r.title.trim()) {
          this.raffleFilterTitle.set(r.title.trim());
        } else {
          this.raffleFilterTitle.set(`Rifa #${raffleId}`);
        }
      });
  }

  private pickerLoadGeneration = 0;

  /** Carga el listado de rifas (misma lógica que Rifas: una página a la vez). */
  loadRafflesForPicker(page: number = this.pickerCurrentPage()): void {
    this.pickerLoadGeneration += 1;
    const gen = this.pickerLoadGeneration;
    this.pickerLoading.set(true);
    this.pickerError.set(null);
    const status = this.pickerStatusFilter().trim();
    this.rafflesService
      .listRaffles(page, this.pickerPerPage(), status || undefined)
      .pipe(
        finalize(() => {
          if (gen === this.pickerLoadGeneration) this.pickerLoading.set(false);
        }),
      )
      .subscribe({
        next: (res) => {
          if (gen !== this.pickerLoadGeneration) return;
          this.pickerRaffles.set(res.data ?? []);
          this.pickerCurrentPage.set(res.current_page ?? page);
          this.pickerLastPage.set(res.last_page ?? 1);
          this.pickerPerPage.set(res.per_page ?? 25);
          const from = res as { from?: number | null; to?: number | null };
          this.pickerFromItem.set(from.from ?? 0);
          this.pickerToItem.set(from.to ?? 0);
          this.pickerTotal.set(res.total ?? 0);
        },
        error: (err) => {
          if (gen !== this.pickerLoadGeneration) return;
          this.pickerRaffles.set([]);
          this.pickerError.set(
            String(
              err?.error?.message || err?.error?.detail || 'No fue posible cargar la lista de rifas.',
            ),
          );
        },
      });
  }

  onPickerSearchInput(value: string): void {
    this.pickerSearchTerm.set(value);
  }

  onPickerStatusFilterChange(value: string): void {
    this.pickerStatusFilter.set(value ?? '');
    this.loadRafflesForPicker(1);
  }

  clearPickerSearch(): void {
    this.pickerSearchTerm.set('');
  }

  pickerGoToPage(p: number): void {
    if (p < 1 || p > this.pickerLastPage() || p === this.pickerCurrentPage()) return;
    this.loadRafflesForPicker(p);
  }

  pickerGoPrevPage(): void {
    this.pickerGoToPage(this.pickerCurrentPage() - 1);
  }

  pickerGoNextPage(): void {
    this.pickerGoToPage(this.pickerCurrentPage() + 1);
  }

  selectRaffleForOrders(raffle: Raffle): void {
    void this.router.navigate(['/dashboard'], {
      queryParams: { view: 'orders', raffle_id: raffle.id },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** URL de imagen para la tarjeta del selector (mismo criterio que en rifas). */
  pickerRaffleImageUrl(raffle: Raffle): string | null {
    if (typeof raffle.banner_image === 'string' && raffle.banner_image.trim()) {
      return raffle.banner_image;
    }
    const u = raffle.image?.url;
    if (typeof u === 'string' && u.trim()) return u;
    return null;
  }

  pickerRaffleStatusLabel(status: string | null | undefined): string {
    return raffleStatusLabelEs(status);
  }

  /** Celdas de fechas (mismo criterio que `Rifas`). */
  pickerEndsAtCell(raffle: Raffle): string {
    const raw = raffle.ends_at as string | null | undefined;
    if (raw == null || String(raw).trim() === '') return 'Pendiente';
    return formatDateTimeDisplay(String(raw)) || 'Pendiente';
  }

  pickerDrawAtCell(raffle: Raffle): string {
    const raw = raffle.draw_at as string | null | undefined;
    if (raw == null || String(raw).trim() === '') return 'Pendiente';
    return formatDateTimeDisplay(String(raw)) || 'Pendiente';
  }

  /** Quitar `raffle_id` de la URL (vuelve al selector de rifa). Cierra detalle de pedido si estaba abierto. */
  clearRaffleFilter(): void {
    void this.router.navigate(['/dashboard'], {
      queryParams: { view: 'orders', raffle_id: null, orderId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Limpia el panel/modal de detalle sin navegar (p. ej. cuando la URL ya no trae `orderId`). */
  private resetDetailPanelState(): void {
    this.ticketQrOpen.set(false);
    this.detailOpen.set(false);
    this.detailError.set(null);
    this.orderDetail.set(null);
    this.reviewNotes.setValue('');
    this.rejectConfirmOpen.set(false);
    this.deleteConfirmOpen.set(false);
    this.orderPendingDelete.set(null);
  }

  /** Query params de la vista órdenes (conserva `raffle_id` al abrir/cerrar detalle). */
  private buildOrdersViewQuery(over: { orderId?: number | null } = {}): Record<string, string | number | null> {
    const q: Record<string, string | number | null> = { view: 'orders' };
    const rid = this.filterRaffleId();
    if (rid != null) q['raffle_id'] = rid;
    if ('orderId' in over) {
      q['orderId'] = over.orderId == null || over.orderId === undefined ? null : over.orderId;
    }
    return q;
  }

  ngOnInit(): void {
    if (this.isAdmin()) this.loadOrderBlockStatus();
  }

  /** Conteos del chart y badges: por `filterRaffleId` o sin filtrar. */
  refreshStatusCounts(): void {
    this.statusCountsLoading.set(true);
    this.chartInsightsLoaded.set(false);
    this.chartsService
      .ordersDistribution(this.filterRaffleId())
      .pipe(
        catchError(() =>
          of({
            raffle_id: null,
            total_orders: 0,
            pending_orders: 0,
            confirmed_orders: 0,
            cancelled_orders: 0,
            pending_tickets: 0,
            confirmed_tickets: 0,
            available: 0,
          }),
        ),
        finalize(() => {
          this.statusCountsLoading.set(false);
          this.chartInsightsLoaded.set(true);
        }),
      )
      .subscribe({
        next: (res) => {
          const pendingOrders = Number(res.pending_orders ?? 0) || 0;
          const confirmedOrders = Number(res.confirmed_orders ?? 0) || 0;
          const cancelledOrders = Number(res.cancelled_orders ?? 0) || 0;

          const pendingTickets = Number(res.pending_tickets ?? 0) || 0;
          const confirmedTickets = Number(res.confirmed_tickets ?? 0) || 0;
          const available = Number(res.available ?? 0) || 0;
          const totalOrders = Number(res.total_orders ?? 0) || 0;

          this.totalOrders.set(Math.max(0, totalOrders));
          this.pendingOrders.set(Math.max(0, pendingOrders));
          this.confirmedOrders.set(Math.max(0, confirmedOrders));
          this.cancelledOrders.set(Math.max(0, cancelledOrders));

          this.countRevisando.set(Math.max(0, pendingTickets));
          this.countPagado.set(Math.max(0, confirmedTickets));
          this.availableTickets.set(available);
          this.chartDonutGrand.set(Math.max(0, pendingTickets + confirmedTickets + available));
        },
      });
  }

  statusTabBadgeCount(filterValue: string): number {
    if (filterValue === '') return this.totalOrders();
    if (filterValue === 'pending_validation') return this.pendingOrders();
    if (filterValue === 'confirmed') return this.confirmedOrders();
    if (filterValue === 'cancelled') return this.cancelledOrders();
    return 0;
  }

  onStatusFilterChange(value: string): void {
    this.statusFilter.set(value ?? '');
    this.reloadFromStart();
  }

  statusLabel(status: string): string {
    return orderStatusLabelEs(status);
  }

  statusClass(status: string): string {
    if (status === 'pending_validation') return 'status-chip status-chip--warn';
    if (status === 'pending_payment') return 'status-chip status-chip--info';
    if (status === 'confirmed') return 'status-chip status-chip--ok';
    if (status === 'cancelled') return 'status-chip status-chip--muted';
    return 'status-chip';
  }

  ticketsCount(order: Order | null | undefined): number | null {
    if (!order) return null;
    const raw = order.tickets_count;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const n = order.tickets?.length;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
    if (this.filterRaffleId() == null) return;
    this.orderSearchDebounce$.next();
  }

  clearSearch(): void {
    const had = this.searchTerm().trim() !== '';
    this.searchTerm.set('');
    if (had && this.filterRaffleId() != null) {
      this.reloadFromStart();
    }
  }

  /** Primera página (o tras cambiar filtro / recargar). Si `refreshStats`, actualiza conteos del gráfico y badges. */
  reloadFromStart(options?: { refreshStats?: boolean }): void {
    if (this.filterRaffleId() == null) return;
    this.listRequestGeneration += 1;
    this.nextOrdersScrollLoadAllowedAt = 0;
    this.clearBulkSelection();
    const gen = this.listRequestGeneration;
    this.loading.set(true);
    // Anula cualquier append en curso y evita solapar con la nueva primera página.
    this.loadingMore.set(false);
    this.error.set(null);
    this.ordersService
      .listOrders(1, this.perPage(), this.statusFilter() || null, this.filterRaffleId(), this.ordersApiSearch())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          if (gen !== this.listRequestGeneration) return;
          this.orderList.set(ordersFlatFromPaginatedResponse(res));
          // El API a veces devuelve `current_page` / `last_page` como string; evitar "1" + 1 === "11".
          const page = Math.max(1, Number(res.current_page ?? 1) || 1);
          const lastP = Math.max(1, Number(res.last_page ?? 1) || 1);
          this.lastLoadedPage.set(page);
          this.lastPage.set(lastP);
          this.perPage.set(Math.max(1, Number(res.per_page ?? 25) || 25));
          this.total.set(Math.max(0, Number(res.total ?? 0) || 0));
          if (options?.refreshStats) this.refreshStatusCounts();
        },
        error: (err) => {
          if (gen !== this.listRequestGeneration) return;
          this.orderList.set([]);
          this.lastLoadedPage.set(0);
          this.error.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible cargar los pedidos.'),
          );
        },
      });
  }

  /**
   * Pide la siguiente página (una sola petición a la vez vía `exhaustMap` en `loadMoreRequests$`).
   */
  private requestNextOrdersPage(): void {
    this.loadMoreRequests$.next();
  }

  /**
   * Cadena una sola petición HTTP; no se inicia otra hasta terminar merge y estado.
   * Tras el merge no se pide otra página automáticamente: evita encadenar varias
   * respuestas mientras el scroll sigue “al fondo” y se mezclan bloques de bancos
   * antes de que el listado asiente; la siguiente carga va solo con scroll del usuario.
   */
  private appendNextOrdersPage$(): Observable<unknown> {
    if (this.filterRaffleId() == null) return EMPTY;
    if (this.loading()) return EMPTY;
    if (!this.hasMore()) return EMPTY;

    const gen = this.listRequestGeneration;
    const nextPage = this.lastLoadedPage() + 1;
    this.loadingMore.set(true);

    return this.ordersService
      .listOrders(
        nextPage,
        this.perPage(),
        this.statusFilter() || null,
        this.filterRaffleId(),
        this.ordersApiSearch(),
      )
      .pipe(
        tap({
          next: (res) => {
            if (gen !== this.listRequestGeneration) return;
            // El API a veces devuelve `current_page` como string; evitar 2 !== "2".
            const gotPage = Number(res.current_page ?? nextPage);
            if (Number.isFinite(gotPage) && Number.isFinite(nextPage) && gotPage !== nextPage) {
              return;
            }
            const incoming = ordersFlatFromPaginatedResponse(res);
            this.orderList.set(mergeOrderPages(this.orderList(), incoming));
            const p = Math.max(1, Number(res.current_page ?? nextPage) || nextPage);
            const lastP = Math.max(1, Number(res.last_page ?? this.lastPage()) || this.lastPage());
            this.lastLoadedPage.set(p);
            this.lastPage.set(lastP);
            this.perPage.set(Math.max(1, Number(res.per_page ?? this.perPage()) || this.perPage()));
            this.total.set(Math.max(0, Number(res.total ?? this.total()) || this.total()));
          },
          error: (err) => {
            if (gen !== this.listRequestGeneration) return;
            this.toast.error(
              String(err?.error?.message || err?.error?.detail || 'No se pudieron cargar más pedidos.'),
            );
          },
        }),
        finalize(() => {
          // Deja de marcar "cargando" tras pintar, no en el mismo tick del merge, para
          // que otra petición no arranque antes de que asienten filas y agrupaciones.
          if (!isPlatformBrowser(this.platformId)) {
            this.loadingMore.set(false);
            this.nextOrdersScrollLoadAllowedAt = Date.now() + OrdersComponent.ORDERS_SCROLL_LOAD_COOLDOWN_MS;
            return;
          }
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              this.loadingMore.set(false);
              this.nextOrdersScrollLoadAllowedAt =
                Date.now() + OrdersComponent.ORDERS_SCROLL_LOAD_COOLDOWN_MS;
            });
          });
        }),
      );
  }

  onOrdersScroll(ev: Event): void {
    if (this.loading() || this.loadingMore()) return;
    if (Date.now() < this.nextOrdersScrollLoadAllowedAt) return;
    const el = ev.target as HTMLElement;
    const threshold = 200;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > threshold) return;
    this.requestNextOrdersPage();
  }

  openDetail(order: Order): void {
    this.orderDetail.set(order);
    this.detailError.set(null);
    if (order.admin_notes) {
      this.reviewNotes.setValue(order.admin_notes);
    } else {
      this.reviewNotes.setValue('');
    }
    void this.router.navigate(['/dashboard'], {
      queryParams: this.buildOrdersViewQuery({ orderId: order.id }),
      replaceUrl: true,
    });
  }

  private loadOrderDetail(id: number): void {
    this.detailError.set(null);
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    if (this.orderDetail()?.id !== id) {
      this.orderDetail.set(null);
      this.reviewNotes.setValue('');
    }
    this.ordersService
      .getOrder(id)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (detail) => {
          this.orderDetail.set(detail);
          if (detail.admin_notes) this.reviewNotes.setValue(detail.admin_notes);
        },
        error: (err) => {
          this.detailError.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible cargar el pedido.'),
          );
        },
      });
  }

  closeDetail(): void {
    if (this.reviewing() || this.deleting()) return;
    this.resetDetailPanelState();
    void this.router.navigate(['/dashboard'], {
      queryParams: this.buildOrdersViewQuery({ orderId: null }),
      replaceUrl: true,
    });
  }

  proofMediaUrl(order: Order): string | null {
    const img = order.payment_proof_image;
    if (img && typeof img === 'object') {
      const u = img['url'];
      if (typeof u === 'string' && u.trim()) {
        return u.startsWith('http') ? u : `${environment.apiBaseUrl}/${u.replace(/^\//, '')}`;
      }
      const p = img['path'];
      if (typeof p === 'string' && p.trim()) {
        return `${environment.apiBaseUrl}/${p.replace(/^\//, '')}`;
      }
    }
    const path = order.payment_proof_path;
    if (path && typeof path === 'string' && path.trim()) {
      return `${environment.apiBaseUrl}/${path.replace(/^\//, '')}`;
    }
    return null;
  }

  isImageProof(order: Order): boolean {
    const img = order.payment_proof_image;
    const mime = img && typeof img === 'object' ? String(img['mime_type'] ?? '') : '';
    if (mime.startsWith('image/')) return true;
    const path = `${order.payment_proof_path ?? ''} ${img && typeof img === 'object' ? String(img['path'] ?? '') : ''}`.toLowerCase();
    return /\.(png|jpe?g|gif|webp)$/i.test(path);
  }

  isPdfProof(order: Order): boolean {
    const img = order.payment_proof_image;
    const mime = img && typeof img === 'object' ? String(img['mime_type'] ?? '').toLowerCase() : '';
    if (mime.includes('pdf')) return true;
    const path = `${order.payment_proof_path ?? ''} ${img && typeof img === 'object' ? String(img['path'] ?? '') : ''}`.toLowerCase();
    return /\.pdf(\?|#|$)/i.test(path) || path.endsWith('.pdf');
  }

  openVoucherPreview(order: Order, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const url = this.proofMediaUrl(order);
    if (!url) return;
    if (this.isImageProof(order)) {
      this.voucherPreviewKind.set('image');
      this.voucherPreviewUrl.set(url);
      this.voucherPreviewOpen.set(true);
      return;
    }
    if (this.isPdfProof(order)) {
      this.voucherPreviewKind.set('pdf');
      this.voucherPreviewUrl.set(url);
      this.voucherPreviewOpen.set(true);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  closeVoucherPreview(): void {
    this.voucherPreviewOpen.set(false);
    this.voucherPreviewUrl.set(null);
    this.voucherPreviewKind.set(null);
  }

  /** Solo dígitos para `tel:` y WhatsApp (RD: 10 dígitos → prefijo país 1). */
  private static phoneDigits(phone: string | null | undefined): string {
    return String(phone ?? '').replace(/\D/g, '');
  }

  telOrderHref(phone: string | null | undefined): string | null {
    const d = OrdersComponent.phoneDigits(phone);
    if (!d) return null;
    const intl = d.length === 10 ? `1${d}` : d;
    return `tel:+${intl}`;
  }

  /** Enlace `wa.me` con número internacional sin `+`. */
  whatsappOrderHref(phone: string | null | undefined): string | null {
    const d = OrdersComponent.phoneDigits(phone);
    if (!d) return null;
    const wa = d.length === 10 ? `1${d}` : d;
    return `https://wa.me/${wa}`;
  }

  ticketNumbersLine(detail: Order): string {
    const list = detail.tickets ?? [];
    if (!list.length) return '—';
    return list
      .map((t) => String(t.number ?? '').trim())
      .filter(Boolean)
      .join(', ');
  }

  /** Fecha del comprobante si viene del API; si no, `updated_at` del pedido. */
  proofUploadedAtIso(detail: Order): string | null {
    const img = detail.payment_proof_image;
    if (img && typeof img === 'object') {
      const c = img['created_at'] ?? img['updated_at'];
      if (typeof c === 'string' && c.trim()) return c;
    }
    const u = detail.updated_at;
    return typeof u === 'string' && u.trim() ? u : null;
  }

  orderShareUrl(detail: Order): string {
    if (!isPlatformBrowser(this.platformId)) return '';
    return `${window.location.origin}/dashboard?view=orders&orderId=${detail.id}`;
  }

  ticketQrImageSrc(detail: Order): string {
    const data = encodeURIComponent(this.orderShareUrl(detail));
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${data}`;
  }

  openTicketQrSheet(): void {
    if (!this.orderDetail()) return;
    this.ticketQrOpen.set(true);
  }

  closeTicketQrSheet(): void {
    this.ticketQrOpen.set(false);
  }

  openVoucherPreviewFromDetail(event?: Event): void {
    const d = this.orderDetail();
    if (!d) return;
    this.openVoucherPreview(d, event);
  }

  copyOrderDetailToClipboard(): void {
    const d = this.orderDetail();
    if (!d) return;
    const nums = this.ticketNumbersLine(d);
    const qty = this.ticketsCount(d);
    const lines = [
      `Pedido #${d.id}`,
      qty != null ? `Cantidad: ${qty}` : '',
      nums !== '—' ? `Números: ${nums}` : '',
      `Nombre: ${d.customer_name}`,
      `Tel: ${d.phone}`,
      `Email: ${d.email}`,
      `Valor: ${formatMoneyDop(d.total_amount) ?? String(d.total_amount ?? '')}`,
      `Estado: ${orderStatusLabelEs(d.status)}`,
      `Rifa: ${d.raffle?.title ?? '—'}`,
      (d.bank_name ?? '').trim() ? `Banco: ${d.bank_name}` : '',
      this.orderShareUrl(d) ? `Enlace: ${this.orderShareUrl(d)}` : '',
    ].filter((x) => x.length > 0);
    this.clipboard.copy(lines.join('\n'));
    this.toast.success('Datos copiados al portapapeles');
  }

  safeVoucherPreviewFrameSrc(): SafeResourceUrl | null {
    const u = this.voucherPreviewUrl();
    if (!u || this.voucherPreviewKind() !== 'pdf') return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(u);
  }

  /**
   * Mismo criterio que el API para revisar: estado pendiente de validación.
   * Normaliza variantes (`PENDING_VALIDATION`, `pending-validation`, etc.).
   */
  canReview(): boolean {
    const o = this.orderDetail();
    if (!o) return false;
    return OrdersComponent.normalizeOrderStatus(o.status) === 'pending_validation';
  }

  /** Comparación de estado tolerante a mayúsculas/guiones del backend. */
  isOrderStatus(
    order: Order,
    expected: 'pending_validation' | 'confirmed' | 'cancelled',
  ): boolean {
    return OrdersComponent.normalizeOrderStatus(order.status) === expected;
  }

  private static normalizeOrderStatus(raw: string | null | undefined): string {
    return String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
  }

  /**
   * Eliminar uno a uno (DELETE unitario): solo admin y estados que el API suele aceptar.
   * La eliminación masiva (`bulk-delete`) admite cualquier estado según el servidor.
   */
  canDeleteOrder(order: Order | null | undefined): boolean {
    if (!this.isAdmin() || !order) return false;
    const s = String(order.status ?? '').trim().toLowerCase();
    return s === 'cancelled' || s === 'confirmed';
  }

  ordersTableColspan(): number {
    return this.isAdmin() ? 10 : 9;
  }

  ordersMobileColspan(): number {
    return this.isAdmin() ? 5 : 4;
  }

  /** Título de rifa en tablas: API, título del filtro activo o `Rifa #id`. */
  orderRaffleLabel(order: Order): string {
    const t = String(order.raffle?.title ?? '').trim();
    if (t) return t;
    const rid = Number(order.raffle_id);
    if (this.filterRaffleId() === rid) {
      const ft = String(this.raffleFilterTitle() ?? '').trim();
      if (ft) return ft;
    }
    if (Number.isFinite(rid) && rid > 0) return `Rifa #${rid}`;
    return '—';
  }

  /** Etiqueta de banco en tabla (solo campo del pedido). */
  orderBankDisplay(order: Order): string {
    const fromOrder = String(order.bank_name ?? '').trim();
    return fromOrder || '—';
  }

  clearBulkSelection(): void {
    this.selectedOrderIds.set([]);
  }

  isOrderSelected(id: number): boolean {
    return this.selectedOrderIds().includes(id);
  }

  toggleOrderSelected(id: number, checked: boolean): void {
    if (!this.isAdmin()) return;
    const set = new Set(this.selectedOrderIds());
    if (checked) set.add(id);
    else set.delete(id);
    this.selectedOrderIds.set([...set].sort((a, b) => a - b));
  }

  onToggleSelectAllVisible(checked: boolean): void {
    if (!this.isAdmin()) return;
    const ids = this.visibleOrders().map((o) => o.id);
    const set = new Set(this.selectedOrderIds());
    if (checked) for (const id of ids) set.add(id);
    else for (const id of ids) set.delete(id);
    this.selectedOrderIds.set([...set].sort((a, b) => a - b));
  }

  /** Móvil: mismo efecto que el checkbox de cabecera, accesible desde la barra de herramientas. */
  toolbarToggleSelectAllVisible(): void {
    if (!this.isAdmin()) return;
    this.onToggleSelectAllVisible(this.selectAllVisibleState() !== 'all');
  }

  openBulkDeleteConfirm(): void {
    if (!this.isAdmin() || this.selectedOrderIds().length === 0) return;
    if (this.bulkDeleting() || this.deleting()) return;
    this.bulkDeleteConfirmOpen.set(true);
  }

  closeBulkDeleteConfirm(): void {
    if (this.bulkDeleting()) return;
    this.bulkDeleteConfirmOpen.set(false);
  }

  confirmBulkDelete(): void {
    if (!this.isAdmin()) {
      this.closeBulkDeleteConfirm();
      this.toast.error('Solo los administradores pueden eliminar pedidos.');
      return;
    }
    const ids = [...this.selectedOrderIds()];
    if (!ids.length) {
      this.closeBulkDeleteConfirm();
      return;
    }
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += ORDERS_BULK_DELETE_MAX_IDS) {
      chunks.push(ids.slice(i, i + ORDERS_BULK_DELETE_MAX_IDS));
    }
    this.bulkDeleting.set(true);
    from(chunks)
      .pipe(
        concatMap((chunk) => this.ordersService.bulkDeleteOrders(chunk)),
        toArray(),
        finalize(() => this.bulkDeleting.set(false)),
      )
      .subscribe({
        next: (responses) => {
          let deletedCount = 0;
          const allDeleted: number[] = [];
          const skipped: BulkOrderDeleteSkipped[] = [];
          for (const r of responses) {
            deletedCount += Number(r.deleted_count ?? 0) || 0;
            if (Array.isArray(r.deleted)) allDeleted.push(...r.deleted);
            if (Array.isArray(r.skipped)) skipped.push(...r.skipped);
          }
          const skipPreview =
            skipped.length > 0
              ? skipped
                  .slice(0, 3)
                  .map((s) => `#${s.id}: ${s.reason}`)
                  .join(' · ')
              : '';
          const moreSkipped = skipped.length > 3 ? ` (+${skipped.length - 3} más)` : '';
          this.toast.success(
            skipped.length
              ? `Eliminados: ${deletedCount}. Omitidos: ${skipped.length}.${skipPreview ? ` ${skipPreview}${moreSkipped}` : ''}`
              : `Eliminados: ${deletedCount} pedido(s).`,
          );
          this.bulkDeleteConfirmOpen.set(false);
          this.clearBulkSelection();
          const openId = this.orderDetail()?.id;
          if (openId != null && allDeleted.includes(openId)) {
            this.detailOpen.set(false);
            this.orderDetail.set(null);
            this.detailError.set(null);
            this.reviewNotes.setValue('');
            this.rejectConfirmOpen.set(false);
            void this.router.navigate(['/dashboard'], {
              queryParams: this.buildOrdersViewQuery({ orderId: null }),
              replaceUrl: true,
            });
          }
          this.reloadFromStart({ refreshStats: true });
        },
        error: (err) => {
          this.toast.error(
            String(err?.error?.message || err?.error?.detail || 'No se pudo eliminar en bloque.'),
          );
        },
      });
  }

  private static userIsAdmin(u: LoginUser | null): boolean {
    if (!u) return false;
    if (u.is_admin === true) return true;
    const role = u.role;
    return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
  }

  /**
   * Abre el diálogo de eliminación. Si pasas `order` (desde la tabla), se usa ese; si no, el `orderDetail()` del modal.
   */
  openDeleteConfirm(order?: Order): void {
    if (!this.isAdmin()) return;
    if (this.reviewing() || this.deleting()) return;
    const o = order ?? this.orderDetail();
    if (!o || !this.canDeleteOrder(o)) return;
    this.orderPendingDelete.set(order ?? null);
    this.deleteConfirmOpen.set(true);
  }

  closeDeleteConfirm(): void {
    if (this.deleting()) return;
    this.deleteConfirmOpen.set(false);
    this.orderPendingDelete.set(null);
  }

  confirmDelete(): void {
    if (!this.isAdmin()) {
      this.closeDeleteConfirm();
      this.toast.error('Solo los administradores pueden eliminar pedidos.');
      return;
    }
    const o = this.orderPendingDelete() ?? this.orderDetail();
    if (!o || !this.canDeleteOrder(o)) {
      this.closeDeleteConfirm();
      return;
    }
    this.deleting.set(true);
    this.ordersService
      .deleteOrder(o.id)
      .pipe(finalize(() => this.deleting.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Pedido eliminado.');
          this.deleteConfirmOpen.set(false);
          this.orderPendingDelete.set(null);
          const wasDetail = this.detailOpen() && this.orderDetail()?.id === o.id;
          if (wasDetail) {
            this.detailOpen.set(false);
            this.orderDetail.set(null);
            this.detailError.set(null);
            this.reviewNotes.setValue('');
            this.rejectConfirmOpen.set(false);
            void this.router.navigate(['/dashboard'], {
              queryParams: this.buildOrdersViewQuery({ orderId: null }),
              replaceUrl: true,
            });
          }
          this.reloadFromStart({ refreshStats: true });
        },
        error: (err) => {
          this.toast.error(
            String(err?.error?.message || err?.error?.detail || 'No se pudo eliminar el pedido.'),
          );
        },
      });
  }

  approve(): void {
    const o = this.orderDetail();
    if (!o || this.reviewing() || !this.canReview()) return;
    this.submitReview(true);
  }

  openRejectConfirm(): void {
    if (!this.canReview() || this.reviewing()) return;
    this.rejectConfirmOpen.set(true);
  }

  closeRejectConfirm(): void {
    if (this.reviewing()) return;
    this.rejectConfirmOpen.set(false);
  }

  confirmReject(): void {
    const o = this.orderDetail();
    if (!o || this.reviewing()) return;
    this.rejectConfirmOpen.set(false);
    this.submitReview(false);
  }

  private submitReview(approved: boolean): void {
    const o = this.orderDetail();
    if (!o) return;
    this.reviewing.set(true);
    this.detailError.set(null);
    const notes = this.reviewNotes.value.trim() || null;
    this.ordersService
      .reviewOrder(o.id, { approved, admin_notes: notes })
      .pipe(finalize(() => this.reviewing.set(false)))
      .subscribe({
        next: (updated) => {
          this.orderDetail.set(updated);
          this.toast.successFromApiResponse(updated, approved ? 'Pedido aprobado' : 'Pedido rechazado');
          this.reloadFromStart({ refreshStats: true });
          if (OrdersComponent.normalizeOrderStatus(updated.status) !== 'pending_validation') {
            this.reviewNotes.setValue(updated.admin_notes ?? '');
          }
        },
        error: (err) => {
          const msg = String(
            err?.error?.message || err?.error?.detail || 'No fue posible actualizar el pedido.',
          );
          this.detailError.set(msg);
          this.toast.error(msg);
        },
      });
  }

  // ── Bloqueo de órdenes públicas ──────────────────────────────

  /** Carga el estado actual del bloqueo desde el API. */
  loadOrderBlockStatus(): void {
    if (!this.isAdmin()) return;
    this.ordersBlockLoading.set(true);
    this.ordersService
      .getOrderBlock()
      .pipe(
        catchError(() => {
          this.toast.error('No se pudo leer el estado de bloqueo de órdenes.');
          return of({ blocked: this.ordersBlocked() });
        }),
        finalize(() => this.ordersBlockLoading.set(false)),
      )
      .subscribe((res) => this.ordersBlocked.set(!!res.blocked));
  }

  /** Alterna el bloqueo de órdenes públicas. */
  toggleOrderBlock(): void {
    if (!this.isAdmin()) {
      this.toast.error('Solo los administradores pueden cambiar el bloqueo de órdenes públicas.');
      return;
    }
    if (this.ordersBlockSaving()) return;
    const newValue = !this.ordersBlocked();
    this.ordersBlockSaving.set(true);
    this.ordersService
      .setOrderBlock(newValue)
      .pipe(finalize(() => this.ordersBlockSaving.set(false)))
      .subscribe({
        next: (res) => {
          this.ordersBlocked.set(!!res.blocked);
          this.toast.success(
            res.blocked
              ? 'Órdenes públicas bloqueadas — los clientes no podrán comprar.'
              : 'Órdenes públicas desbloqueadas — los clientes pueden comprar.',
          );
        },
        error: (err) => {
          // Revertir localmente al estado anterior
          this.ordersBlocked.set(!newValue);
          this.toast.error(
            String(err?.error?.message || err?.error?.detail || 'No se pudo cambiar el bloqueo de órdenes.'),
          );
        },
      });
  }
}
