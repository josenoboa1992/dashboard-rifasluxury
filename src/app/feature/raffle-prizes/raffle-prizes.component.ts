import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { finalize, map, switchMap } from 'rxjs/operators';

import { Raffle, RafflesService } from '../../core/raffles/services/raffles.service';
import { raffleStatusLabelEs } from '../../core/helpers/ui-labels.es';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { FormatMoneyPipe } from '../../core/pipes/format-money.pipe';

export type PrizeStateVariant = 'available' | 'sold_out' | 'upcoming' | 'ended' | 'neutral';

@Component({
  selector: 'app-raffle-prizes',
  standalone: true,
  imports: [CommonModule, SpinnerComponent, FormatDateTimePipe, FormatMoneyPipe],
  templateUrl: './raffle-prizes.component.html',
  styleUrl: './raffle-prizes.component.css',
})
export class RafflePrizesComponent implements OnInit {
  private readonly rafflesService = inject(RafflesService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly raffles = signal<Raffle[]>([]);

  readonly detailOpen = signal(false);
  readonly detailRaffle = signal<Raffle | null>(null);

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
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
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (all) => {
          const sorted = [...all].sort((a, b) =>
            this.raffleTitle(a).localeCompare(this.raffleTitle(b), 'es', { sensitivity: 'base' }),
          );
          this.raffles.set(sorted);
        },
        error: (err) => {
          const message =
            err?.error?.message || err?.error?.detail || 'No fue posible cargar las rifas.';
          this.error.set(String(message));
        },
      });
  }

  raffleStatusLabel(status: string | null | undefined): string {
    return raffleStatusLabelEs(status);
  }

  raffleTitle(r: Raffle): string {
    const t = r.title?.trim();
    return t && t.length > 0 ? t : `Rifa #${r.id}`;
  }

  prizeState(r: Raffle): { label: string; variant: PrizeStateVariant; hint: string } {
    const status = (r.status || '').toLowerCase().trim();
    const avail = r.tickets_available_count;

    if (status === 'drawn' || status === 'completed' || status === 'closed' || status === 'finished') {
      return {
        label: 'Finalizado',
        variant: 'ended',
        hint: 'Sorteo realizado o rifa cerrada.',
      };
    }

    if (avail !== undefined && avail === 0) {
      return {
        label: 'Agotado',
        variant: 'sold_out',
        hint: 'No quedan boletos a la venta.',
      };
    }

    if (avail !== undefined && avail > 0) {
      return {
        label: 'Disponible',
        variant: 'available',
        hint: `Quedan ${avail} boleto(s).`,
      };
    }

    if (status === 'draft' || status === 'pending') {
      return {
        label: 'Próximamente',
        variant: 'upcoming',
        hint: 'Aún no está a la venta.',
      };
    }

    if (
      status === 'active' ||
      status === 'open' ||
      status === 'published' ||
      status === 'live' ||
      status === 'selling'
    ) {
      return {
        label: avail === undefined ? 'En venta' : 'Disponible',
        variant: 'available',
        hint: avail === undefined ? 'Venta activa.' : `Quedan ${avail} boleto(s).`,
      };
    }

    if (status.includes('sold') || status === 'sold_out') {
      return { label: 'Agotado', variant: 'sold_out', hint: 'Sin boletos disponibles.' };
    }

    return {
      label: r.status || '—',
      variant: 'neutral',
      hint: 'Revisa el estado en el módulo Rifas.',
    };
  }

  openDetail(r: Raffle): void {
    this.detailRaffle.set(r);
    this.detailOpen.set(true);
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.detailRaffle.set(null);
  }
}
