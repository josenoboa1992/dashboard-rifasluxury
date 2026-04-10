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
  ManualBulkWinnerRow,
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

interface ManualBulkRow {
  raffle_title: string;
  prize_label: string;
  display_name: string;
  ticket_number: string;
  notify_email: string;
  photo: File | null;
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
  /** Vista del listado de ganadores manuales (opción del desplegable). */
  readonly manualWinnersViewSelected = signal(false);

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

  readonly manualModalOpen = signal(false);
  readonly manualSubmitting = signal(false);
  readonly manualModalError = signal<string | null>(null);
  readonly manualPhotoFile = signal<File | null>(null);

  readonly manualBulkModalOpen = signal(false);
  readonly manualBulkSubmitting = signal(false);
  readonly manualBulkModalError = signal<string | null>(null);
  readonly manualBulkRows = signal<ManualBulkRow[]>([
    {
      raffle_title: '',
      prize_label: '',
      display_name: '',
      ticket_number: '',
      notify_email: '',
      photo: null,
    },
  ]);

  readonly manualListLoading = signal(false);
  readonly manualListError = signal<string | null>(null);
  readonly manualWinners = signal<RaffleWinner[]>([]);
  readonly manualCurrentPage = signal(1);
  readonly manualLastPage = signal(1);
  readonly manualPerPage = signal(25);
  readonly manualFromItem = signal(0);
  readonly manualToItem = signal(0);
  readonly manualTotal = signal(0);

  readonly manualViewOpen = signal(false);
  readonly manualViewWinner = signal<RaffleWinner | null>(null);

  readonly manualEditModalOpen = signal(false);
  readonly manualEditSubmitting = signal(false);
  readonly manualEditModalError = signal<string | null>(null);
  readonly manualEditPhotoFile = signal<File | null>(null);
  readonly manualEditWinnerId = signal<number | null>(null);

  /** Si el diálogo de borrado aplica a un ganador manual (DELETE /winners/manual/{id}). */
  readonly deleteIsManual = signal(false);

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

  manualForm = this.fb.nonNullable.group({
    raffle_title: ['', [Validators.required, Validators.minLength(1)]],
    prize_label: ['', [Validators.required, Validators.minLength(1)]],
    display_name: ['', [Validators.required, Validators.minLength(1)]],
    ticket_number: [''],
    notify_email: ['', [Validators.email]],
  });

  manualEditForm = this.fb.nonNullable.group({
    raffle_title: ['', [Validators.required, Validators.minLength(1)]],
    prize_label: ['', [Validators.required, Validators.minLength(1)]],
    display_name: ['', [Validators.required, Validators.minLength(1)]],
    ticket_number: [''],
    notify_email: ['', [Validators.email]],
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

  readonly manualPageNumbers = computed(() => {
    const current = this.manualCurrentPage();
    const last = this.manualLastPage();
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
    const raffle = this.displayRaffleTitle(w);
    if (this.deleteIsManual()) {
      return `¿Eliminar el ganador manual (${raffle}, boleto ${num}, ${name})? Esta acción no se puede deshacer.`;
    }
    return `¿Eliminar el ganador publicado (${raffle}, boleto ${num}, ${name})? Esta acción no se puede deshacer.`;
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

  /** Valor del &lt;select&gt;: vacío, "manual" o id de rifa. */
  pickerValue(): string {
    if (this.manualWinnersViewSelected()) return 'manual';
    const r = this.selectedRaffle();
    return r ? String(r.id) : '';
  }

  onPickerChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    if (!target) return;
    const raw = target.value;
    if (raw === '' || raw === undefined) {
      this.manualWinnersViewSelected.set(false);
      this.onRaffleSelected(null);
      return;
    }
    if (raw === 'manual') {
      this.manualWinnersViewSelected.set(true);
      this.onRaffleSelected(null);
      this.loadManualWinners(1);
      return;
    }
    this.manualWinnersViewSelected.set(false);
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

  loadManualWinners(page: number = this.manualCurrentPage()): void {
    this.manualListLoading.set(true);
    this.manualListError.set(null);
    this.winnersService
      .listManualWinners(page, this.manualPerPage())
      .pipe(finalize(() => this.manualListLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.manualWinners.set(res.data ?? []);
          this.manualCurrentPage.set(res.current_page ?? page);
          this.manualLastPage.set(res.last_page ?? 1);
          this.manualPerPage.set(res.per_page ?? 25);
          this.manualFromItem.set(res.from ?? 0);
          this.manualToItem.set(res.to ?? 0);
          this.manualTotal.set(res.total ?? 0);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible cargar los ganadores manuales.';
          this.manualListError.set(String(message));
        },
      });
  }

  goToManualPage(page: number): void {
    if (page < 1 || page > this.manualLastPage() || page === this.manualCurrentPage()) return;
    this.loadManualWinners(page);
  }

  goPrevManualPage(): void {
    this.goToManualPage(this.manualCurrentPage() - 1);
  }

  goNextManualPage(): void {
    this.goToManualPage(this.manualCurrentPage() + 1);
  }

  /** Título de rifa para filas del listado manual (sin depender de rifa seleccionada). */
  manualListRaffleTitle(w: RaffleWinner): string {
    const d = w.display_raffle_title ?? w.custom_raffle_title;
    if (typeof d === 'string' && d.trim()) return d.trim();
    return '—';
  }

  manualNotifyEmailCell(w: RaffleWinner): string {
    const e = w.notify_email;
    if (typeof e === 'string' && e.trim()) return e.trim();
    return '—';
  }

  openManualViewModal(w: RaffleWinner): void {
    this.manualViewWinner.set(w);
    this.manualViewOpen.set(true);
  }

  closeManualViewModal(): void {
    this.manualViewOpen.set(false);
    this.manualViewWinner.set(null);
  }

  openManualEditModal(w: RaffleWinner): void {
    this.manualEditModalError.set(null);
    this.manualEditPhotoFile.set(null);
    this.manualEditWinnerId.set(w.id);
    const numRaw = w.display_ticket_number ?? w.custom_ticket_number;
    const ticket = typeof numRaw === 'string' && numRaw.trim() ? numRaw.trim() : '';
    const email =
      typeof w.notify_email === 'string' && w.notify_email.trim() ? w.notify_email.trim() : '';
    const raffleTitle = this.manualListRaffleTitle(w);
    this.manualEditForm.reset({
      raffle_title: raffleTitle === '—' ? '' : raffleTitle,
      prize_label: w.prize_label ?? '',
      display_name: w.display_name ?? '',
      ticket_number: ticket,
      notify_email: email,
    });
    this.manualEditModalOpen.set(true);
  }

  closeManualEditModal(): void {
    if (this.manualEditSubmitting()) return;
    this.manualEditModalOpen.set(false);
    this.manualEditWinnerId.set(null);
  }

  onManualEditPhotoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.manualEditPhotoFile.set(input.files?.[0] ?? null);
  }

  submitManualEdit(): void {
    const id = this.manualEditWinnerId();
    if (id === null || this.manualEditForm.invalid) {
      this.manualEditForm.markAllAsTouched();
      return;
    }
    const v = this.manualEditForm.getRawValue();
    const email = v.notify_email?.trim() ?? '';
    if (email) {
      const ctrl = this.fb.control(email, [Validators.email]);
      if (ctrl.invalid) {
        this.manualEditModalError.set('Introduce un correo válido o déjalo vacío.');
        return;
      }
    }
    this.manualEditSubmitting.set(true);
    this.manualEditModalError.set(null);
    this.winnersService
      .updateManualWinner(id, {
        raffle_title: v.raffle_title,
        prize_label: v.prize_label,
        display_name: v.display_name,
        ticket_number: v.ticket_number?.trim() || '',
        notify_email: email,
        photo: this.manualEditPhotoFile() ?? undefined,
      })
      .pipe(finalize(() => this.manualEditSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Ganador manual actualizado.');
          this.manualEditModalOpen.set(false);
          this.manualEditWinnerId.set(null);
          if (this.manualWinnersViewSelected()) {
            this.loadManualWinners(this.manualCurrentPage());
          }
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : null) ||
            'No fue posible actualizar el ganador manual.';
          this.manualEditModalError.set(String(msg));
        },
      });
  }

  requestDeleteManualWinner(w: RaffleWinner): void {
    this.deleteIsManual.set(true);
    this.deleteTarget.set(w);
    this.deleteConfirmOpen.set(true);
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

  /** Título de rifa para tabla (manual usa display/custom; por rifa elige la seleccionada). */
  displayRaffleTitle(w: RaffleWinner): string {
    const d = w.display_raffle_title ?? w.custom_raffle_title;
    if (typeof d === 'string' && d.trim()) return d.trim();
    const sr = this.selectedRaffle();
    return sr ? this.raffleOptionLabel(sr) : '—';
  }

  isManualWinner(w: RaffleWinner): boolean {
    return w.raffle_id == null;
  }

  getTicketNumber(w: RaffleWinner): string {
    const displayNum = w.display_ticket_number ?? w.custom_ticket_number;
    if (typeof displayNum === 'string' && displayNum.trim()) return displayNum.trim();
    const t = w.ticket;
    if (t && typeof t === 'object') {
      const n = (t as Record<string, unknown>)['number'];
      if (typeof n === 'string' || typeof n === 'number') return String(n);
    }
    return '—';
  }

  requestDeleteWinner(w: RaffleWinner): void {
    this.deleteIsManual.set(false);
    this.deleteTarget.set(w);
    this.deleteConfirmOpen.set(true);
  }

  closeDeleteConfirm(): void {
    if (this.deletingWinnerId() !== null) return;
    this.deleteConfirmOpen.set(false);
    this.deleteTarget.set(null);
    this.deleteIsManual.set(false);
  }

  confirmDeleteWinner(): void {
    const target = this.deleteTarget();
    if (!target || this.deletingWinnerId() !== null) return;

    if (this.deleteIsManual()) {
      const page = this.manualCurrentPage();
      const wasOnlyOnPage = this.manualWinners().length === 1;
      this.deletingWinnerId.set(target.id);
      this.winnersService
        .deleteManualWinner(target.id)
        .pipe(finalize(() => this.deletingWinnerId.set(null)))
        .subscribe({
          next: () => {
            this.deleteConfirmOpen.set(false);
            this.deleteTarget.set(null);
            this.deleteIsManual.set(false);
            this.toast.success('Ganador manual eliminado.');
            if (wasOnlyOnPage && page > 1) {
              this.loadManualWinners(page - 1);
            } else {
              this.loadManualWinners(page);
            }
          },
          error: (err) => {
            const msg =
              err?.error?.message ||
              err?.error?.detail ||
              'No fue posible eliminar el ganador manual.';
            this.toast.error(String(msg));
          },
        });
      return;
    }

    const raffle = this.selectedRaffle();
    if (!raffle) return;

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
          this.deleteIsManual.set(false);
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

  openManualModal(): void {
    this.manualModalError.set(null);
    this.manualPhotoFile.set(null);
    this.manualForm.reset({
      raffle_title: '',
      prize_label: '',
      display_name: '',
      ticket_number: '',
      notify_email: '',
    });
    this.manualModalOpen.set(true);
  }

  closeManualModal(): void {
    if (this.manualSubmitting()) return;
    this.manualModalOpen.set(false);
  }

  onManualPhotoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.manualPhotoFile.set(file);
  }

  openManualBulkModal(): void {
    this.manualBulkModalError.set(null);
    this.manualBulkRows.set([
      {
        raffle_title: '',
        prize_label: '',
        display_name: '',
        ticket_number: '',
        notify_email: '',
        photo: null,
      },
    ]);
    this.manualBulkModalOpen.set(true);
  }

  closeManualBulkModal(): void {
    if (this.manualBulkSubmitting()) return;
    this.manualBulkModalOpen.set(false);
  }

  addManualBulkRow(): void {
    this.manualBulkRows.update((rows) => [
      ...rows,
      {
        raffle_title: '',
        prize_label: '',
        display_name: '',
        ticket_number: '',
        notify_email: '',
        photo: null,
      },
    ]);
  }

  removeManualBulkRow(index: number): void {
    this.manualBulkRows.update((rows) => {
      if (rows.length <= 1) return rows;
      return rows.filter((_, i) => i !== index);
    });
  }

  updateManualBulkRow<K extends keyof ManualBulkRow>(index: number, key: K, value: ManualBulkRow[K]): void {
    this.manualBulkRows.update((rows) =>
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }

  onManualBulkFieldInput(
    index: number,
    key: 'raffle_title' | 'prize_label' | 'display_name' | 'ticket_number' | 'notify_email',
    event: Event,
  ): void {
    const target = event.target as HTMLInputElement | null;
    if (!target) return;
    this.updateManualBulkRow(index, key, target.value);
  }

  onManualBulkPhotoChange(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.updateManualBulkRow(index, 'photo', file);
  }

  submitManualBulk(): void {
    const rows = this.manualBulkRows();
    const payload: ManualBulkWinnerRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const title = row.raffle_title.trim();
      const prize = row.prize_label.trim();
      const name = row.display_name.trim();
      if (!title || !prize || !name) {
        this.manualBulkModalError.set(
          `Fila ${i + 1}: título de rifa, premio y nombre a mostrar son obligatorios.`,
        );
        return;
      }
      const email = row.notify_email.trim();
      if (email) {
        const ctrl = this.fb.control(email, [Validators.email]);
        if (ctrl.invalid) {
          this.manualBulkModalError.set(`Fila ${i + 1}: correo no válido o déjalo vacío.`);
          return;
        }
      }
      payload.push({
        raffle_title: title,
        prize_label: prize,
        display_name: name,
        ticket_number: row.ticket_number.trim() || undefined,
        notify_email: email || undefined,
        photo: row.photo ?? undefined,
      });
    }

    this.manualBulkSubmitting.set(true);
    this.manualBulkModalError.set(null);
    this.winnersService
      .bulkCreateManualWinners(payload)
      .pipe(finalize(() => this.manualBulkSubmitting.set(false)))
      .subscribe({
        next: (res) => {
          const n = res.winners?.length ?? payload.length;
          this.toast.success(
            n === 1 ? 'Ganador manual publicado.' : `${n} ganadores manuales publicados.`,
          );
          this.manualBulkModalOpen.set(false);
          if (this.manualWinnersViewSelected()) {
            this.manualCurrentPage.set(1);
            this.loadManualWinners(1);
          }
          if (this.selectedRaffle()) {
            this.loadWinners(this.currentPage());
          }
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : null) ||
            'No fue posible publicar los ganadores manuales.';
          this.manualBulkModalError.set(String(msg));
        },
      });
  }

  submitManual(): void {
    if (this.manualForm.invalid) {
      this.manualForm.markAllAsTouched();
      return;
    }
    this.manualSubmitting.set(true);
    this.manualModalError.set(null);
    const v = this.manualForm.getRawValue();
    this.winnersService
      .createManualWinner({
        raffle_title: v.raffle_title,
        prize_label: v.prize_label,
        display_name: v.display_name,
        ticket_number: v.ticket_number?.trim() || undefined,
        notify_email: v.notify_email?.trim() || undefined,
        photo: this.manualPhotoFile() ?? undefined,
      })
      .pipe(finalize(() => this.manualSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.toast.success('Ganador manual publicado.');
          this.manualModalOpen.set(false);
          if (this.manualWinnersViewSelected()) {
            this.loadManualWinners(this.manualCurrentPage());
          }
          if (this.selectedRaffle()) {
            this.loadWinners(this.currentPage());
          }
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            (typeof err?.error === 'string' ? err.error : null) ||
            'No fue posible publicar el ganador manual.';
          this.manualModalError.set(String(msg));
        },
      });
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
