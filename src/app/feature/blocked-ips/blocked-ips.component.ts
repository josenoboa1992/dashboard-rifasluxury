import { CommonModule } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { MatIconModule } from '@angular/material/icon';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import {
  BlockedIp,
  PaginatedBlockedIpsResponse,
  SecurityService,
} from '../../core/security/services/security.service';

@Component({
  selector: 'app-blocked-ips',
  standalone: true,
  imports: [
    CommonModule,
    SpinnerComponent,
    MatIconModule,
    ConfirmDialogComponent,
    FormatDateTimePipe,
  ],
  templateUrl: './blocked-ips.component.html',
  styleUrl: './blocked-ips.component.css',
})
export class BlockedIpsComponent implements OnInit {
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly rows = signal<BlockedIp[]>([]);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);

  readonly unblockConfirmOpen = signal(false);
  readonly unblockTarget = signal<BlockedIp | null>(null);
  readonly unblockingIp = signal<string | null>(null);

  private readonly searchReload = new Subject<void>();

  readonly pageNumbers = computed(() => {
    const current = this.currentPage();
    const last = this.lastPage();
    const start = Math.max(1, current - 2);
    const end = Math.min(last, current + 2);
    const pages: number[] = [];
    for (let i = start; i <= end; i += 1) pages.push(i);
    return pages;
  });

  readonly unblockConfirmMessage = computed(() => {
    const t = this.unblockTarget();
    return t
      ? `¿Quitar el bloqueo de la IP ${t.ip_address}? Podrá volver a comprar desde esa dirección según las reglas del checkout.`
      : '';
  });

  constructor(
    private readonly securityService: SecurityService,
    private readonly toast: ToastService,
  ) {
    this.searchReload.pipe(debounceTime(350), takeUntilDestroyed()).subscribe(() => {
      this.currentPage.set(1);
      this.loadPage(1);
    });
  }

  ngOnInit(): void {
    this.loadPage(1);
  }

  loadPage(page: number = this.currentPage()): void {
    this.loading.set(true);
    this.listError.set(null);
    const q = this.searchTerm().trim();
    this.securityService
      .listBlockedIps(page, this.perPage(), q.length ? q : null)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => this.applyResponse(res, page),
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible cargar las IPs bloqueadas.';
          this.listError.set(String(message));
        },
      });
  }

  private applyResponse(res: PaginatedBlockedIpsResponse, page: number): void {
    this.rows.set(res.data ?? []);
    this.currentPage.set(res.current_page ?? page);
    this.lastPage.set(res.last_page ?? 1);
    this.perPage.set(res.per_page ?? 25);
    this.fromItem.set(res.from ?? 0);
    this.toItem.set(res.to ?? 0);
    this.total.set(res.total ?? 0);
  }

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
    this.searchReload.next();
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.searchReload.next();
  }

  onPerPageChange(raw: string): void {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(100, Math.max(1, Math.floor(n)));
    if (clamped === this.perPage()) return;
    this.perPage.set(clamped);
    this.currentPage.set(1);
    this.loadPage(1);
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.currentPage()) return;
    this.loadPage(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  openUnblockConfirm(row: BlockedIp): void {
    this.unblockTarget.set(row);
    this.unblockConfirmOpen.set(true);
  }

  closeUnblockConfirm(): void {
    if (this.unblockingIp() !== null) return;
    this.unblockConfirmOpen.set(false);
    this.unblockTarget.set(null);
  }

  confirmUnblock(): void {
    const row = this.unblockTarget();
    if (!row) return;
    const ip = row.ip_address.trim();
    if (!ip.length) return;

    this.unblockingIp.set(ip);
    this.securityService
      .removeBlockedIp(ip)
      .pipe(finalize(() => this.unblockingIp.set(null)))
      .subscribe({
        next: () => {
          this.toast.success('IP desbloqueada.');
          this.unblockConfirmOpen.set(false);
          this.unblockTarget.set(null);
          this.loadPage(this.currentPage());
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No se pudo desbloquear la IP.';
          this.toast.error(String(message));
        },
      });
  }
}
