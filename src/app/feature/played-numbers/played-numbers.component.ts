import { CommonModule, JsonPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { finalize, map, switchMap } from 'rxjs/operators';

import {
  PaginatedSoldTicketsResponse,
  Raffle,
  RaffleTicketSold,
  RafflesService,
  SoldTicketOrder,
  SoldTicketParticipant,
} from '../../core/raffles/services/raffles.service';
import { orderStatusLabelEs } from '../../core/helpers/ui-labels.es';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-played-numbers',
  standalone: true,
  imports: [
    CommonModule,
    JsonPipe,
    SpinnerComponent,
    MatIconModule,
  ],
  templateUrl: './played-numbers.component.html',
  styleUrl: './played-numbers.component.css',
})
export class PlayedNumbersComponent implements OnInit {
  private readonly rafflesService = inject(RafflesService);
  private readonly toast = inject(ToastService);

  readonly rafflesLoading = signal(false);
  readonly rafflesError = signal<string | null>(null);
  readonly raffles = signal<Raffle[]>([]);
  readonly selectedRaffle = signal<Raffle | null>(null);

  readonly listLoading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly tickets = signal<RaffleTicketSold[]>([]);
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(50);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);
  /** Filtro local sobre la página cargada (número, participante, pedidos). */
  readonly ticketSearchTerm = signal('');

  readonly detailOpen = signal(false);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  /** Fila del listado sold (incluye orders + participant). */
  readonly detailModalRow = signal<RaffleTicketSold | null>(null);
  readonly ticketDetail = signal<Record<string, unknown> | null>(null);
  readonly detailTicketId = signal<number | null>(null);

  readonly pageNumbers = computed(() => {
    const current = this.currentPage();
    const last = this.lastPage();
    const start = Math.max(1, current - 2);
    const end = Math.min(last, current + 2);
    const pages: number[] = [];
    for (let i = start; i <= end; i += 1) pages.push(i);
    return pages;
  });

  /** Pantalla de carga completa solo si no hay `orders` en el listado y falta el GET de detalle. */
  readonly detailShowFullSpinner = computed(() => {
    if (!this.detailLoading()) return false;
    const row = this.detailModalRow();
    const o = row?.orders;
    return !Array.isArray(o) || o.length === 0;
  });

  readonly hasActiveTicketFilter = computed(() => this.ticketSearchTerm().trim().length > 0);

  readonly visibleTickets = computed(() => {
    const term = this.ticketSearchTerm().trim().toLowerCase();
    const rows = this.tickets();
    if (!term) return rows;
    return rows.filter((row) => this.ticketRowMatchesSearch(row, term));
  });

  ngOnInit(): void {
    this.loadRafflesForSelect();
  }

  loadRafflesForSelect(): void {
    this.rafflesLoading.set(true);
    this.rafflesError.set(null);
    const perPage = 100;
    this.rafflesService
      .listRaffles(1, perPage)
      .pipe(
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
        finalize(() => this.rafflesLoading.set(false)),
      )
      .subscribe({
        next: (all) => {
          const sorted = [...all].sort((a, b) =>
            this.raffleLabel(a).localeCompare(this.raffleLabel(b), 'es', { sensitivity: 'base' }),
          );
          this.raffles.set(sorted);
        },
        error: (err) => {
          const message =
            err?.error?.message || err?.error?.detail || 'No fue posible cargar las rifas.';
          this.rafflesError.set(String(message));
        },
      });
  }

  raffleLabel(r: Raffle): string {
    const t = r.title?.trim();
    return t && t.length > 0 ? t : `Rifa #${r.id}`;
  }

  onRaffleSelectedFromSelect(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target) return;
    const raw = target.value;
    if (raw === '' || raw === undefined) {
      this.onRaffleSelected(null);
      return;
    }
    const id = Number(raw);
    this.onRaffleSelected(Number.isFinite(id) ? id : null);
  }

  onRaffleSelected(raffleId: number | null): void {
    if (raffleId === null || raffleId === undefined) {
      this.selectedRaffle.set(null);
      this.tickets.set([]);
      this.ticketSearchTerm.set('');
      return;
    }
    const r = this.raffles().find((x) => x.id === raffleId) ?? null;
    this.selectedRaffle.set(r);
    this.ticketSearchTerm.set('');
    this.currentPage.set(1);
    this.loadSoldTickets(1);
  }

  loadSoldTickets(page: number = this.currentPage()): void {
    const raffle = this.selectedRaffle();
    if (!raffle) return;

    this.listLoading.set(true);
    this.listError.set(null);
    this.rafflesService
      .listSoldTickets(raffle.id, page, this.perPage())
      .pipe(finalize(() => this.listLoading.set(false)))
      .subscribe({
        next: (res) => {
          const norm = this.normalizeSoldTicketsPage(res);
          this.tickets.set(norm.data);
          this.currentPage.set(norm.current_page);
          this.lastPage.set(norm.last_page);
          this.perPage.set(norm.per_page);
          this.fromItem.set(norm.from ?? 0);
          this.toItem.set(norm.to ?? 0);
          this.total.set(norm.total);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible cargar los boletos vendidos (GET …/tickets/sold).';
          this.listError.set(String(message));
          this.tickets.set([]);
        },
      });
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.lastPage() || p === this.currentPage()) return;
    this.loadSoldTickets(p);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  openTicketDetail(row: RaffleTicketSold): void {
    const raffle = this.selectedRaffle();
    if (!raffle || row.id == null || row.id <= 0) {
      this.toast.error('No se pudo abrir el detalle de este boleto.');
      return;
    }
    const hasOrders = Array.isArray(row.orders) && row.orders.length > 0;

    this.detailTicketId.set(row.id);
    this.detailModalRow.set(row);
    this.detailError.set(null);
    this.ticketDetail.set(null);
    this.detailOpen.set(true);
    this.detailLoading.set(!hasOrders);

    this.rafflesService
      .getRaffleTicket(raffle.id, row.id)
      .pipe(finalize(() => this.detailLoading.set(false)))
      .subscribe({
        next: (body) => this.ticketDetail.set(body),
        error: (err) => {
          if (!hasOrders) {
            const msg =
              err?.error?.message ||
              err?.error?.detail ||
              'No fue posible cargar el detalle del boleto.';
            this.detailError.set(String(msg));
          }
        },
      });
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.detailModalRow.set(null);
    this.ticketDetail.set(null);
    this.detailError.set(null);
    this.detailTicketId.set(null);
  }

  private normalizeSoldTicketsPage(res: PaginatedSoldTicketsResponse): {
    data: RaffleTicketSold[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
    from: number | null;
    to: number | null;
  } {
    const meta = res.meta;
    if (meta) {
      return {
        data: res.data ?? [],
        current_page: meta.current_page ?? 1,
        last_page: meta.last_page ?? 1,
        per_page: meta.per_page ?? 50,
        total: meta.total ?? 0,
        from: meta.from ?? null,
        to: meta.to ?? null,
      };
    }
    return {
      data: res.data ?? [],
      current_page: res.current_page ?? 1,
      last_page: res.last_page ?? 1,
      per_page: res.per_page ?? 50,
      total: res.total ?? 0,
      from: res.from ?? null,
      to: res.to ?? null,
    };
  }

  latestOrder(row: RaffleTicketSold): SoldTicketOrder | undefined {
    const o = row.orders;
    if (!Array.isArray(o) || o.length === 0) return undefined;
    return o[0];
  }

  participantFromRow(row: RaffleTicketSold): SoldTicketParticipant | null {
    const lo = this.latestOrder(row)?.participant;
    if (lo) return lo;
    const p = row.participant;
    return p && typeof p === 'object' ? p : null;
  }

  ticketRowLabel(row: RaffleTicketSold): string {
    const p = this.participantFromRow(row) as (SoldTicketParticipant & Record<string, unknown>) | null;
    const name = this.coerceParticipantName(p);
    if (name) return name;

    const o = this.latestOrder(row) as (SoldTicketOrder & Record<string, unknown>) | undefined;
    const cust = typeof o?.['customer_name'] === 'string' ? o['customer_name'].trim() : '';
    if (cust) return cust;

    const cedula = String(p?.cedula ?? '').trim();
    if (cedula) return cedula;

    const phone = String(p?.phone ?? '').trim();
    if (phone) return phone;

    const email = String(p?.email ?? '').trim();
    if (email) return email;

    return '—';
  }

  latestOrderSummary(row: RaffleTicketSold): string {
    const o = this.latestOrder(row);
    if (!o) return '—';
    const st = o.status ? ` · ${this.statusLabel(o.status)}` : '';
    return `#${o.id}${st}`;
  }

  onPerPageChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target) return;
    const v = Math.min(500, Math.max(1, Number(target.value)));
    this.perPage.set(v);
    this.currentPage.set(1);
    this.loadSoldTickets(1);
  }

  onTicketSearchInput(event: Event): void {
    const t = event.target as HTMLInputElement | null;
    this.ticketSearchTerm.set(t?.value ?? '');
  }

  clearTicketSearch(): void {
    this.ticketSearchTerm.set('');
  }

  private ticketRowMatchesSearch(row: RaffleTicketSold, term: string): boolean {
    const parts: string[] = [
      row.number,
      row.status,
      String(row.id),
      this.statusLabel(row.status),
    ];
    const p = this.participantFromRow(row);
    if (p) {
      parts.push(
        p.name,
        p.email ?? '',
        p.phone ?? '',
        p.cedula ?? '',
        String(p.id),
      );
    }
    const orders = row.orders;
    if (Array.isArray(orders)) {
      for (const o of orders) {
        parts.push(String(o.id), o.status ?? '');
        const op = o.participant;
        if (op) {
          parts.push(
            op.name,
            op.email ?? '',
            op.phone ?? '',
            op.cedula ?? '',
            String(op.id),
          );
        }
      }
    }
    const hay = parts.join(' ').toLowerCase();
    return hay.includes(term);
  }

  /** Boleto, pedido u otro estado conocido → etiqueta en español. */
  statusLabel(status: string | undefined): string {
    return orderStatusLabelEs(status);
  }

  asObj(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private coerceParticipantName(
    p: (SoldTicketParticipant & Record<string, unknown>) | null,
  ): string | null {
    if (!p) return null;
    const candidates = [p.name, p['display_name'], p['full_name'], p['customer_name']];
    for (const c of candidates) {
      if (typeof c === 'string') {
        const v = c.trim();
        if (v) return v;
      }
    }
    return null;
  }
}
