import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { forkJoin, merge, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, finalize, map } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { LoginUser } from '../../core/auth/models/login-response.model';
import { AuthService } from '../../core/auth/services/auth.service';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { orderStatusLabelEs } from '../../core/helpers/ui-labels.es';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { FormatMoneyPipe } from '../../core/pipes/format-money.pipe';
import { DrCedulaPipe } from '../../core/pipes/dr-cedula.pipe';
import { formatMoneyDop } from '../../core/helpers/money-format.helper';
import { ChartsService } from '../../core/charts/services/charts.service';
import { Order, OrdersService, PaginatedOrdersResponse } from '../../core/orders/services/orders.service';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

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
    DrCedulaPipe,
    ClipboardModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
  ],
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.css',
})
export class OrdersComponent implements OnInit {
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  readonly error = signal<string | null>(null);
  readonly orders = signal<Order[]>([]);
  readonly searchTerm = signal('');
  /** Filtro enviado al API (`''` = todos). */
  readonly statusFilter = signal('');
  readonly lastLoadedPage = signal(0);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly total = signal(0);

  /** Carga del chart global + badges de pestañas. */
  readonly statusCountsLoading = signal(false);
  /** Total de pedidos (todas las rifas) desde `/api/admin/charts/orders-distribution`. */
  readonly totalOrders = signal(0);
  /** Denominador del donut: pending + confirmed + available (sin cancelados). */
  readonly chartDonutGrand = signal(0);
  readonly countRevisando = signal(0);
  readonly countPagado = signal(0);
  readonly countCancelado = signal(0);
  /** Cupo disponible total (suma pool restante de todas las rifas). */
  readonly availableTickets = signal(0);
  /** Evita “parpadeo” vacío mientras llega el primer payload del chart. */
  readonly chartInsightsLoaded = signal(false);

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
      { key: 'revisando', label: 'Revisando', n: this.countRevisando(), color: '#ea580c' },
      { key: 'pagado', label: 'Pagado', n: this.countPagado(), color: '#16a34a' },
    ];
    return list
      .filter((r) => r.n > 0)
      .map((r) => ({
        ...r,
        pct: (r.n / grand) * 100,
      }));
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
    const pct = (n: number) => (Math.max(0, n) / grand) * 100;
    const revisando = this.countRevisando();
    const pagado = this.countPagado();
    const disponible = this.availableTickets();
    const parts: string[] = [];
    if (revisando > 0) parts.push(`Revisando ${Math.round(pct(revisando) * 10) / 10}%`);
    if (pagado > 0) parts.push(`Pagado ${Math.round(pct(pagado) * 10) / 10}%`);
    if (disponible > 0) parts.push(`Disponible ${Math.round(pct(disponible) * 10) / 10}%`);
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
  /** Invalida respuestas de `loadNextPage` si hubo `reloadFromStart` entretanto. */
  private listRequestGeneration = 0;
  readonly reviewNotes = this.fb.nonNullable.control('');

  /** Igual que en el dashboard: `role === 'admin'` o `is_admin === true`. */
  readonly sessionUser = signal<LoginUser | null>(this.auth.getSessionUser());
  readonly isAdmin = computed(() => OrdersComponent.userIsAdmin(this.sessionUser()));

  readonly visibleOrders = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.orders();
    return this.orders().filter((o) => {
      const hay = `${o.customer_name} ${o.cedula} ${o.email} ${o.phone} ${o.status} ${o.raffle?.title ?? ''} ${o.id}`.toLowerCase();
      return hay.includes(term);
    });
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
    const st = String(o.status ?? '').trim().toLowerCase();
    const release =
      st === 'confirmed' || st === 'cancelled'
        ? ' Se liberan los boletos asociados.'
        : '';
    return `¿Eliminar definitivamente el pedido #${o.id} (${o.customer_name})? Solo los administradores pueden eliminar pedidos en estado cancelado o pagado.${release} Esta acción no se puede deshacer.`;
  });

  constructor(
    private readonly ordersService: OrdersService,
    private readonly chartsService: ChartsService,
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
        if (orderId == null) return;
        this.loadOrderDetail(orderId);
      });
  }

  private parseOrderIdFromUrl(): number | null {
    const tree = this.router.parseUrl(this.router.url);
    const raw = tree.queryParams['orderId'];
    const s = Array.isArray(raw) ? raw[0] : raw;
    if (s == null || s === '') return null;
    const id = Number.parseInt(String(s), 10);
    return Number.isFinite(id) && id >= 1 ? id : null;
  }

  ngOnInit(): void {
    this.refreshStatusCounts();
    this.reloadFromStart();
  }

  /** Conteos globales (chart admin) + badges de pestañas. */
  refreshStatusCounts(): void {
    this.statusCountsLoading.set(true);
    this.chartsService
      .ordersDistribution()
      .pipe(
        catchError(() =>
          of({
            total_orders: 0,
            pending: 0,
            confirmed: 0,
            cancelled: 0,
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
          const pending = Number(res.pending ?? 0) || 0;
          const confirmed = Number(res.confirmed ?? 0) || 0;
          const available = Number(res.available ?? 0) || 0;
          const cancelled = Number(res.cancelled ?? 0) || 0;
          const totalOrders = Number(res.total_orders ?? 0) || 0;

          this.totalOrders.set(Math.max(0, totalOrders));
          this.countRevisando.set(pending);
          this.countPagado.set(confirmed);
          this.availableTickets.set(available);
          this.countCancelado.set(cancelled);
          this.chartDonutGrand.set(Math.max(0, pending + confirmed + available));
        },
      });
  }

  statusTabBadgeCount(filterValue: string): number {
    if (filterValue === '') return this.totalOrders();
    if (filterValue === 'pending_validation') return this.countRevisando();
    if (filterValue === 'confirmed') return this.countPagado();
    if (filterValue === 'cancelled') return this.countCancelado();
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
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }

  /** Primera página (o tras cambiar filtro / recargar). Si `refreshStats`, actualiza conteos del gráfico y badges. */
  reloadFromStart(options?: { refreshStats?: boolean }): void {
    this.listRequestGeneration += 1;
    const gen = this.listRequestGeneration;
    this.loading.set(true);
    this.loadingMore.set(false);
    this.error.set(null);
    this.ordersService
      .listOrders(1, this.perPage(), this.statusFilter() || null)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          if (gen !== this.listRequestGeneration) return;
          this.orders.set(res.data ?? []);
          this.lastLoadedPage.set(res.current_page ?? 1);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 25);
          this.total.set(res.total ?? 0);
          if (options?.refreshStats) this.refreshStatusCounts();
        },
        error: (err) => {
          if (gen !== this.listRequestGeneration) return;
          this.orders.set([]);
          this.lastLoadedPage.set(0);
          this.error.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible cargar los pedidos.'),
          );
        },
      });
  }

  loadNextPage(): void {
    if (!this.hasMore() || this.loading() || this.loadingMore()) return;
    const gen = this.listRequestGeneration;
    const nextPage = this.lastLoadedPage() + 1;
    this.loadingMore.set(true);
    this.ordersService
      .listOrders(nextPage, this.perPage(), this.statusFilter() || null)
      .pipe(finalize(() => this.loadingMore.set(false)))
      .subscribe({
        next: (res) => {
          if (gen !== this.listRequestGeneration) return;
          const cur = this.orders();
          const batch = res.data ?? [];
          const ids = new Set(cur.map((o) => o.id));
          const merged = [...cur, ...batch.filter((o) => !ids.has(o.id))];
          this.orders.set(merged);
          this.lastLoadedPage.set(res.current_page ?? nextPage);
          this.lastPage.set(res.last_page ?? this.lastPage());
          this.perPage.set(res.per_page ?? this.perPage());
          this.total.set(res.total ?? this.total());
        },
        error: (err) => {
          if (gen !== this.listRequestGeneration) return;
          this.toast.error(
            String(err?.error?.message || err?.error?.detail || 'No se pudieron cargar más pedidos.'),
          );
        },
      });
  }

  onOrdersScroll(ev: Event): void {
    const el = ev.target as HTMLElement;
    const threshold = 200;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > threshold) return;
    this.loadNextPage();
  }

  openDetail(order: Order): void {
    void this.router.navigate(['/dashboard'], {
      queryParams: { view: 'orders', orderId: order.id },
      replaceUrl: true,
    });
  }

  private loadOrderDetail(id: number): void {
    this.detailError.set(null);
    this.reviewNotes.setValue('');
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    this.orderDetail.set(null);
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
    this.ticketQrOpen.set(false);
    this.detailOpen.set(false);
    this.detailError.set(null);
    this.orderDetail.set(null);
    this.reviewNotes.setValue('');
    this.rejectConfirmOpen.set(false);
    this.deleteConfirmOpen.set(false);
    this.orderPendingDelete.set(null);
    void this.router.navigate(['/dashboard'], {
      queryParams: { view: 'orders', orderId: null },
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
      `Cédula: ${d.cedula || '—'}`,
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

  canReview(): boolean {
    return this.orderDetail()?.status === 'pending_validation';
  }

  /** Solo administradores; el API permite DELETE cuando el pedido está `cancelled` o `confirmed`. */
  canDeleteOrder(order: Order | null | undefined): boolean {
    if (!this.isAdmin() || !order) return false;
    const s = String(order.status ?? '').trim().toLowerCase();
    return s === 'cancelled' || s === 'confirmed';
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
    if (!this.canDeleteOrder(o)) return;
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
              queryParams: { view: 'orders', orderId: null },
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
          if (updated.status !== 'pending_validation') {
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
}
