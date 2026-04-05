import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Subject, finalize, takeUntil } from 'rxjs';

import {
  ClientHistoryByRaffle,
  ClientHistoryByStatusBucket,
  ClientHistoryResponse,
  coerceClientHistoryTicketNumbers,
  ParticipantsService,
  SegmentThresholds,
} from '../../core/participants/services/participants.service';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { FormatMoneyPipe } from '../../core/pipes/format-money.pipe';
import { DrCedulaMaskDirective } from '../../core/ui/masks/dr-cedula-mask.directive';
import { DrPhoneMaskDirective } from '../../core/ui/masks/dr-phone-mask.directive';

@Component({
  selector: 'app-client-consultation',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SpinnerComponent,
    FormatMoneyPipe,
    DrCedulaMaskDirective,
    DrPhoneMaskDirective,
  ],
  templateUrl: './client-consultation.component.html',
  styleUrl: './client-consultation.component.css',
})
export class ClientConsultationComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly participantsService = inject(ParticipantsService);
  private readonly toast = inject(ToastService);

  /** Evita que respuestas de una consulta anterior pisen resultado o autocompletado. */
  private consultGeneration = 0;

  /** Cancela HTTP en curso al iniciar otra consulta o al limpiar. */
  private readonly consultAbort$ = new Subject<void>();

  readonly loading = signal(false);
  readonly result = signal<ClientHistoryResponse | null>(null);
  /** Rifas cuyos boletos están desplegados en el grid del historial. */
  readonly expandedRaffleIds = signal<Set<number>>(new Set());

  readonly form = this.fb.nonNullable.group({
    name: [''],
    cedula: [''],
    phone: [''],
    email: [''],
    ticket_number: [''],
  });

  ngOnInit(): void {
    this.form.reset({
      name: '',
      cedula: '',
      phone: '',
      email: '',
      ticket_number: '',
    });
  }

  /**
   * Umbrales de segmentación: ignora `[]` o valores no objeto que envía el API.
   */
  segmentThresholdsForDisplay(
    seg: Pick<ClientHistoryResponse, 'segment_thresholds'>,
  ): SegmentThresholds | null {
    const t = seg.segment_thresholds as unknown;
    if (t == null || Array.isArray(t) || typeof t !== 'object') return null;
    const o = t as Record<string, unknown>;
    if (o['plata'] == null && o['oro'] == null && o['platinum'] == null) return null;
    return {
      plata: Number(o['plata'] ?? 0),
      oro: Number(o['oro'] ?? 0),
      platinum: Number(o['platinum'] ?? 0),
    };
  }

  /** Modificador CSS para la pastilla según `segment` del API (bronce, oro, platino → platinum, etc.). */
  segmentModifier(segment: string): string {
    const s = String(segment || 'bronce').toLowerCase().trim();
    if (s === 'platino') return 'platinum';
    return s.replace(/\s+/g, '-');
  }

  /**
   * Números de boletos jugados en la rifa (si el API los envía en `ticket_numbers` o `tickets`).
   */
  ticketsForRaffle(row: ClientHistoryByRaffle): string[] {
    if (row.ticket_numbers?.length) {
      return row.ticket_numbers.map((n) => String(n).trim()).filter(Boolean);
    }
    if (!row.tickets?.length) return [];
    return row.tickets
      .map((t) => (typeof t === 'string' ? t.trim() : String(t.number ?? '').trim()))
      .filter(Boolean);
  }

  /** Números en `by_status.*` desde `ticket_numbers` o lista `tickets`. */
  ticketNumbersFromStatusBucket(bucket: ClientHistoryByStatusBucket | undefined | null): string[] {
    if (!bucket) return [];
    const coerced = coerceClientHistoryTicketNumbers(bucket.ticket_numbers);
    if (coerced.length) {
      return coerced.map((n) => String(n).trim()).filter(Boolean);
    }
    if (!bucket.tickets?.length) return [];
    return bucket.tickets
      .map((t) => (typeof t === 'string' ? t.trim() : String(t.number ?? '').trim()))
      .filter(Boolean);
  }

  toggleRaffleTickets(raffleId: number): void {
    this.expandedRaffleIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(raffleId)) next.delete(raffleId);
      else next.add(raffleId);
      return next;
    });
  }

  isRaffleTicketsExpanded(raffleId: number): boolean {
    return this.expandedRaffleIds().has(raffleId);
  }

  raffleStatusLabel(status: string): string {
    const s = String(status || '').toLowerCase();
    const map: Record<string, string> = {
      active: 'Activa',
      open: 'Abierta',
      completed: 'Completada',
      closed: 'Cerrada',
      cancelled: 'Cancelada',
      drawn: 'Sorteada',
      published: 'Publicada',
      selling: 'En venta',
    };
    return map[s] ?? status;
  }

  hasAtLeastOneCriterion(): boolean {
    const v = this.form.getRawValue();
    return (
      !!v.name?.trim() ||
      !!v.cedula?.trim() ||
      !!v.phone?.trim() ||
      !!v.ticket_number?.trim()
    );
  }

  consult(): void {
    if (!this.hasAtLeastOneCriterion()) {
      this.toast.error('Indica al menos uno: nombre, cédula, teléfono o número de boleto.');
      return;
    }
    const v = this.form.getRawValue();
    const query = {
      name: v.name.trim() || undefined,
      cedula: v.cedula.trim() || undefined,
      phone: v.phone.trim() || undefined,
      ticket_number: v.ticket_number.trim() || undefined,
    };
    this.consultAbort$.next();
    const generation = ++this.consultGeneration;
    this.form.reset({ name: '', cedula: '', phone: '', email: '', ticket_number: '' });
    this.loading.set(true);
    this.result.set(null);
    this.expandedRaffleIds.set(new Set());
    this.participantsService
      .getClientHistory(query)
      .pipe(
        takeUntil(this.consultAbort$),
        finalize(() => {
          if (generation === this.consultGeneration) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.consultGeneration) return;
          if (!res.found) {
            this.result.set(null);
            this.toast.error('No se encontraron pedidos confirmados para ese criterio.');
            return;
          }
          this.result.set(res);
          queueMicrotask(() => {
            if (generation !== this.consultGeneration) return;
            this.autofillFromParticipant(res, generation);
          });
        },
        error: (err) => {
          if (generation !== this.consultGeneration) return;
          const msg = String(
            err?.error?.message ||
              err?.error?.errors?.query?.[0] ||
              err?.error?.detail ||
              'No fue posible consultar el historial.',
          );
          this.toast.error(msg);
        },
      });
  }

  /**
   * Rellena el formulario con los datos del participante de esta respuesta (no mezcla con búsquedas previas).
   * `generation` debe coincidir con la consulta en curso para ignorar `getParticipant` obsoleto.
   */
  private autofillFromParticipant(res: ClientHistoryResponse, generation: number): void {
    const patchIdentity = (name: string, cedula: string, phone: string, email: string) => {
      if (generation !== this.consultGeneration) return;
      this.form.patchValue({
        name: name ?? '',
        cedula: cedula ?? '',
        phone: phone ?? '',
        email: email ?? '',
      });
    };

    if (res.client) {
      patchIdentity(
        res.client.name,
        res.client.cedula,
        res.client.phone,
        res.client.email ?? '',
      );
      return;
    }

    const p0 = res.participants?.[0];
    if (p0) {
      patchIdentity(p0.name, p0.cedula ?? '', p0.phone ?? '', p0.email ?? '');
      return;
    }

    const id = res.participant_ids?.[0];
    if (id == null) return;

    this.participantsService
      .getParticipant(id)
      .pipe(takeUntil(this.consultAbort$))
      .subscribe({
        next: (p) => {
          if (generation !== this.consultGeneration) return;
          this.form.patchValue({
            name: p.name ?? '',
            cedula: p.cedula ?? '',
            phone: p.phone ?? '',
            email: p.email ?? '',
          });
        },
        error: () => {},
      });
  }

  clearForm(): void {
    this.consultAbort$.next();
    this.consultGeneration++;
    this.loading.set(false);
    this.form.reset({ name: '', cedula: '', phone: '', email: '', ticket_number: '' });
    this.result.set(null);
    this.expandedRaffleIds.set(new Set());
  }
}
