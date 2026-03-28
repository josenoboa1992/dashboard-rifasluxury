import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { finalize, map, switchMap } from 'rxjs/operators';

import {
  Raffle,
  RafflesService,
  TicketParticipantByNumberResponse,
} from '../../core/raffles/services/raffles.service';
import {
  BulkWinnerRow,
  RaffleWinner,
  RaffleWinnersService,
} from '../../core/raffle-winners/services/raffle-winners.service';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { MatIconModule } from '@angular/material/icon';

interface BulkRow {
  number: string;
  prize_label: string;
  display_name: string;
  photo: File | null;
  lookupError: string | null;
}

@Component({
  selector: 'app-winners',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SpinnerComponent,
    ConfirmDialogComponent,
    FormatDateTimePipe,
    MatIconModule,
  ],
  templateUrl: './winners.component.html',
  styleUrl: './winners.component.css',
})
export class WinnersComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly rafflesService = inject(RafflesService);
  private readonly winnersService = inject(RaffleWinnersService);
  private readonly toast = inject(ToastService);

  readonly rafflesLoading = signal(false);
  readonly rafflesError = signal<string | null>(null);
  readonly raffles = signal<Raffle[]>([]);

  readonly selectedRaffle = signal<Raffle | null>(null);

  readonly listLoading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly winners = signal<RaffleWinner[]>([]);
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);

  readonly addModalOpen = signal(false);
  readonly addSubmitting = signal(false);
  readonly addModalError = signal<string | null>(null);
  readonly addPhotoFile = signal<File | null>(null);
  readonly addTicketLookupLoading = signal(false);
  readonly addTicketLookupError = signal<string | null>(null);
  readonly addLastLookupNumber = signal<string | null>(null);

  readonly editModalOpen = signal(false);
  readonly editSubmitting = signal(false);
  readonly editModalError = signal<string | null>(null);
  readonly editWinnerId = signal<number | null>(null);
  readonly editPhotoFile = signal<File | null>(null);

  readonly deleteConfirmOpen = signal(false);
  readonly deleteTarget = signal<RaffleWinner | null>(null);
  readonly deletingWinnerId = signal<number | null>(null);

  readonly bulkModalOpen = signal(false);
  readonly bulkSubmitting = signal(false);
  readonly bulkModalError = signal<string | null>(null);
  readonly bulkRows = signal<BulkRow[]>([
    {
      number: '',
      prize_label: '',
      display_name: '',
      photo: null,
      lookupError: null,
    },
  ]);
  readonly bulkLookupRowIndex = signal<number | null>(null);
  readonly bulkMarkDrawn = signal(false);

  addForm = this.fb.nonNullable.group({
    number: ['', [Validators.required, Validators.minLength(1)]],
    prize_label: ['', [Validators.required, Validators.minLength(1)]],
    display_name: [''],
    mark_drawn: [false],
  });

  editForm = this.fb.nonNullable.group({
    prize_label: ['', [Validators.required, Validators.minLength(1)]],
    display_name: [''],
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

  readonly deleteConfirmMessage = computed(() => {
    const w = this.deleteTarget();
    if (!w) return '';
    const num = this.getTicketNumber(w);
    const name = w.display_name?.trim() || 'sin nombre';
    return `¿Eliminar el ganador publicado (boleto ${num}, ${name})? Esta acción no se puede deshacer.`;
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
          if (last <= 1) {
            return of(batch);
          }
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
            this.raffleOptionLabel(a).localeCompare(this.raffleOptionLabel(b), 'es', {
              sensitivity: 'base',
            }),
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

  /** Texto del &lt;option&gt;: solo el nombre de la rifa. */
  raffleOptionLabel(r: Raffle): string {
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
      this.winners.set([]);
      return;
    }
    const r = this.raffles().find((x) => x.id === raffleId) ?? null;
    this.selectedRaffle.set(r);
    this.currentPage.set(1);
    this.loadWinners(1);
  }

  loadWinners(page: number = this.currentPage()): void {
    const raffle = this.selectedRaffle();
    if (!raffle) return;

    this.listLoading.set(true);
    this.listError.set(null);
    this.winnersService
      .listWinners(raffle.id, page, this.perPage())
      .pipe(finalize(() => this.listLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.winners.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 25);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.total.set(res.total ?? 0);
        },
        error: (err) => {
          const message =
            err?.error?.message || err?.error?.detail || 'No fue posible cargar los ganadores.';
          this.listError.set(String(message));
        },
      });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.currentPage()) return;
    this.loadWinners(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  photoRequiredSingle(): boolean {
    const r = this.selectedRaffle();
    return (r?.winners_count ?? 1) > 1;
  }

  photoRequiredBulk(): boolean {
    const r = this.selectedRaffle();
    const rows = this.bulkRows();
    if (!r) return false;
    return (r.winners_count ?? 1) > 1 || rows.length > 1;
  }

  photoRequiredEdit(w: RaffleWinner): boolean {
    const r = this.selectedRaffle();
    if (!r) return false;
    return (r.winners_count ?? 1) > 1 && !w.portrait_image_id;
  }

  getTicketNumber(w: RaffleWinner): string {
    const t = w.ticket;
    if (t && typeof t === 'object') {
      const n = (t as Record<string, unknown>)['number'];
      if (typeof n === 'string' || typeof n === 'number') return String(n);
    }
    return '-';
  }

  requestDeleteWinner(w: RaffleWinner): void {
    this.deleteTarget.set(w);
    this.deleteConfirmOpen.set(true);
  }

  closeDeleteConfirm(): void {
    if (this.deletingWinnerId() !== null) return;
    this.deleteConfirmOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDeleteWinner(): void {
    const raffle = this.selectedRaffle();
    const target = this.deleteTarget();
    if (!raffle || !target || this.deletingWinnerId() !== null) return;

    const page = this.currentPage();
    const wasOnlyOnPage = this.winners().length === 1;

    this.deletingWinnerId.set(target.id);
    this.winnersService
      .deleteWinner(raffle.id, target.id)
      .pipe(finalize(() => this.deletingWinnerId.set(null)))
      .subscribe({
        next: () => {
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
          this.toast.success('Ganador eliminado.');
          if (wasOnlyOnPage && page > 1) {
            this.loadWinners(page - 1);
          } else {
            this.loadWinners(page);
          }
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible eliminar el ganador.';
          this.toast.error(String(msg));
        },
      });
  }

  openAddModal(): void {
    if (!this.selectedRaffle()) {
      this.toast.error('Selecciona una rifa primero.');
      return;
    }
    this.addModalError.set(null);
    this.addPhotoFile.set(null);
    this.addTicketLookupError.set(null);
    this.addLastLookupNumber.set(null);
    this.addForm.reset({
      number: '',
      prize_label: '',
      display_name: '',
      mark_drawn: false,
    });
    this.addModalOpen.set(true);
  }

  closeAddModal(): void {
    if (this.addSubmitting()) return;
    this.addModalOpen.set(false);
  }

  onAddPhotoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.addPhotoFile.set(file);
  }

  onAddNumberInput(): void {
    const cur = this.addForm.controls.number.value.trim();
    const last = this.addLastLookupNumber();
    if (last !== null && cur !== last.trim()) {
      this.addLastLookupNumber.set(null);
      this.addTicketLookupError.set(null);
    }
  }

  lookupAddTicketNumber(): void {
    const raffle = this.selectedRaffle();
    if (!raffle) {
      this.addTicketLookupError.set('Selecciona una rifa.');
      return;
    }
    const num = this.addForm.controls.number.value.trim();
    if (!num) {
      this.addTicketLookupError.set('Ingresa un número de boleto.');
      return;
    }
    this.addTicketLookupLoading.set(true);
    this.addTicketLookupError.set(null);
    this.rafflesService
      .getTicketParticipantByNumber(raffle.id, num)
      .pipe(finalize(() => this.addTicketLookupLoading.set(false)))
      .subscribe({
        next: (data) => {
          this.addLastLookupNumber.set(data.ticket.number);
          const prizeLabel =
            data.raffle?.title?.trim() ||
            this.selectedRaffle()?.title?.trim() ||
            '';
          this.addForm.patchValue({
            number: data.ticket.number,
            display_name: this.preferredDisplayName(data),
            prize_label: prizeLabel,
          });
        },
        error: (err) => {
          this.addLastLookupNumber.set(null);
          const msg =
            err?.error?.message ||
            err?.error?.detail ||
            'No se encontró el boleto o no aplica para esta rifa.';
          this.addTicketLookupError.set(String(msg));
        },
      });
  }

  private preferredDisplayName(data: TicketParticipantByNumberResponse): string {
    const fromParticipant = data.participant?.name?.trim();
    if (fromParticipant) return fromParticipant;
    return data.order?.customer_name?.trim() || '';
  }

  submitAdd(): void {
    const raffle = this.selectedRaffle();
    if (!raffle || this.addForm.invalid) return;

    const photo = this.addPhotoFile();
    if (this.photoRequiredSingle() && !photo) {
      this.addModalError.set('Esta rifa tiene varios ganadores: la foto es obligatoria.');
      return;
    }

    this.addSubmitting.set(true);
    this.addModalError.set(null);
    const v = this.addForm.getRawValue();
    this.winnersService
      .createWinner(raffle.id, {
        number: v.number,
        prize_label: v.prize_label,
        display_name: v.display_name?.trim() || undefined,
        mark_drawn: v.mark_drawn,
        photo: photo ?? undefined,
      })
      .pipe(finalize(() => this.addSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Ganador publicado.');
          this.addModalOpen.set(false);
          this.loadWinners(this.currentPage());
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : null) ||
            'No fue posible publicar el ganador.';
          this.addModalError.set(String(msg));
        },
      });
  }

  openEditModal(w: RaffleWinner): void {
    this.editModalError.set(null);
    this.editPhotoFile.set(null);
    this.editWinnerId.set(w.id);
    this.editForm.reset({
      prize_label: w.prize_label ?? '',
      display_name: w.display_name ?? '',
    });
    this.editModalOpen.set(true);
  }

  closeEditModal(): void {
    if (this.editSubmitting()) return;
    this.editModalOpen.set(false);
    this.editWinnerId.set(null);
  }

  onEditPhotoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.editPhotoFile.set(file);
  }

  submitEdit(): void {
    const raffle = this.selectedRaffle();
    const winnerId = this.editWinnerId();
    if (!raffle || winnerId === null || this.editForm.invalid) return;

    const current = this.winners().find((x) => x.id === winnerId);
    const photo = this.editPhotoFile();
    if (current && this.photoRequiredEdit(current) && !photo) {
      this.editModalError.set('Debes adjuntar la foto del ganador.');
      return;
    }

    this.editSubmitting.set(true);
    this.editModalError.set(null);
    const v = this.editForm.getRawValue();
    this.winnersService
      .updateWinner(raffle.id, winnerId, {
        prize_label: v.prize_label,
        display_name: v.display_name,
        photo: photo ?? undefined,
      })
      .pipe(finalize(() => this.editSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Ganador actualizado.');
          this.editModalOpen.set(false);
          this.editWinnerId.set(null);
          this.loadWinners(this.currentPage());
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : null) ||
            'No fue posible actualizar el ganador.';
          this.editModalError.set(String(msg));
        },
      });
  }

  setBulkMarkDrawn(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    const checked = target.checked;
    this.bulkMarkDrawn.set(checked);
  }

  openBulkModal(): void {
    if (!this.selectedRaffle()) {
      this.toast.error('Selecciona una rifa primero.');
      return;
    }
    this.bulkModalError.set(null);
    this.bulkMarkDrawn.set(false);
    this.bulkRows.set([
      {
        number: '',
        prize_label: '',
        display_name: '',
        photo: null,
        lookupError: null,
      },
    ]);
    this.bulkModalOpen.set(true);
  }

  closeBulkModal(): void {
    if (this.bulkSubmitting()) return;
    this.bulkModalOpen.set(false);
  }

  addBulkRow(): void {
    this.bulkRows.update((rows) => [
      ...rows,
      {
        number: '',
        prize_label: '',
        display_name: '',
        photo: null,
        lookupError: null,
      },
    ]);
  }

  removeBulkRow(index: number): void {
    this.bulkRows.update((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((_, i) => i !== index);
    });
  }

  updateBulkRow<K extends keyof BulkRow>(index: number, key: K, value: BulkRow[K]): void {
    this.bulkRows.update((rows) =>
      rows.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [key]: value } as BulkRow;
        if (key === 'number') {
          next.lookupError = null;
        }
        return next;
      }),
    );
  }

  onBulkFieldInput(
    index: number,
    key: 'number' | 'prize_label' | 'display_name',
    event: Event,
  ): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    this.updateBulkRow(index, key, target.value);
  }

  private patchBulkRow(index: number, patch: Partial<BulkRow>): void {
    this.bulkRows.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  lookupBulkRow(index: number): void {
    const raffle = this.selectedRaffle();
    if (!raffle) return;
    const rows = this.bulkRows();
    const row = rows[index];
    if (!row) return;
    const num = row.number.trim();
    if (!num) {
      this.patchBulkRow(index, {
        lookupError: 'Ingresa un número de boleto.',
      });
      return;
    }
    this.bulkLookupRowIndex.set(index);
    this.patchBulkRow(index, { lookupError: null });
    this.rafflesService
      .getTicketParticipantByNumber(raffle.id, num)
      .pipe(finalize(() => this.bulkLookupRowIndex.set(null)))
      .subscribe({
        next: (data) => {
          const prizeLabel =
            data.raffle?.title?.trim() ||
            this.selectedRaffle()?.title?.trim() ||
            '';
          this.patchBulkRow(index, {
            number: data.ticket.number,
            display_name: this.preferredDisplayName(data),
            prize_label: prizeLabel,
            lookupError: null,
          });
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            err?.error?.detail ||
            'No se encontró el boleto o no aplica para esta rifa.';
          this.patchBulkRow(index, { lookupError: String(msg) });
        },
      });
  }

  onBulkPhotoChange(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.updateBulkRow(index, 'photo', file);
  }

  submitBulk(): void {
    const raffle = this.selectedRaffle();
    if (!raffle) return;

    const rows = this.bulkRows();
    const needPhoto = this.photoRequiredBulk();
    const payload: BulkWinnerRow[] = [];

    for (const row of rows) {
      const num = row.number.trim();
      const prize = row.prize_label.trim();
      if (!num || !prize) {
        this.bulkModalError.set('Cada fila debe tener número de boleto y premio.');
        return;
      }
      if (needPhoto && !row.photo) {
        this.bulkModalError.set(
          'Con varios ganadores o varias filas, cada ítem requiere foto.',
        );
        return;
      }
      payload.push({
        number: num,
        prize_label: prize,
        display_name: row.display_name.trim() || undefined,
        photo: row.photo ?? undefined,
      });
    }

    this.bulkSubmitting.set(true);
    this.bulkModalError.set(null);
    this.winnersService
      .bulkCreateWinners(raffle.id, payload, this.bulkMarkDrawn())
      .pipe(finalize(() => this.bulkSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Ganadores publicados.');
          this.bulkModalOpen.set(false);
          this.loadWinners(1);
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : null) ||
            'No fue posible publicar los ganadores.';
          this.bulkModalError.set(String(msg));
        },
      });
  }
}
