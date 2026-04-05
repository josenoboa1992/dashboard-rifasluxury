import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NavigationEnd, Router } from '@angular/router';
import { merge, of } from 'rxjs';
import { distinctUntilChanged, filter, finalize, map } from 'rxjs/operators';

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
import { Order, OrdersService } from '../../core/orders/services/orders.service';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SpinnerComponent,
    ConfirmDialogComponent,
    FormatDateTimePipe,
    FormatMoneyPipe,
    DrCedulaPipe,
    MatButtonModule,
    MatCardModule,
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
  readonly error = signal<string | null>(null);
  readonly orders = signal<Order[]>([]);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);

  readonly detailOpen = signal(false);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly orderDetail = signal<Order | null>(null);
  readonly reviewing = signal(false);

  readonly rejectConfirmOpen = signal(false);

  /** Pedido cancelado a eliminar (listado); si es null, se usa `orderDetail()` en el modal. */
  readonly orderPendingDelete = signal<Order | null>(null);
  readonly deleteConfirmOpen = signal(false);
  readonly deleting = signal(false);

  /** Vista previa del comprobante desde el listado (imagen o PDF en iframe). */
  readonly voucherPreviewOpen = signal(false);
  readonly voucherPreviewUrl = signal<string | null>(null);
  readonly voucherPreviewKind = signal<'image' | 'pdf' | null>(null);

  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly auth = inject(AuthService);
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

  readonly pageNumbers = computed(() => {
    const current = this.currentPage();
    const last = this.lastPage();
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
    return `¿Eliminar definitivamente el pedido #${o.id} (${o.customer_name})? Solo los pedidos cancelados pueden eliminarse. Esta acción no se puede deshacer.`;
  });

  constructor(
    private readonly ordersService: OrdersService,
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
      .subscribe((id) => {
        if (id == null) return;
        this.loadOrderDetail(id);
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
    this.loadOrders();
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

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }

  loadOrders(page: number = this.currentPage()): void {
    this.loading.set(true);
    this.error.set(null);
    this.ordersService
      .listOrders(page, this.perPage())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.orders.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 25);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.total.set(res.total ?? 0);
        },
        error: (err) => {
          this.error.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible cargar los pedidos.'),
          );
        },
      });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.currentPage()) return;
    this.loadOrders(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
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

  safeVoucherPreviewFrameSrc(): SafeResourceUrl | null {
    const u = this.voucherPreviewUrl();
    if (!u || this.voucherPreviewKind() !== 'pdf') return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(u);
  }

  canReview(): boolean {
    return this.orderDetail()?.status === 'pending_validation';
  }

  /** Solo administradores; el API solo permite DELETE cuando el pedido está cancelado. */
  canDeleteOrder(order: Order | null | undefined): boolean {
    return this.isAdmin() && order?.status === 'cancelled';
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
    if (!o || o.status !== 'cancelled') {
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
          this.loadOrders(this.currentPage());
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
          this.loadOrders(this.currentPage());
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
