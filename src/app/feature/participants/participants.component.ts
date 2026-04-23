import { CommonModule } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { MatIconModule } from '@angular/material/icon';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import {
  Participant,
  ParticipantPayload,
  PaginatedParticipantsResponse,
  ParticipantsService,
} from '../../core/participants/services/participants.service';
import { digitsOnly } from '../../core/helpers/dr-phone-cedula-format';
import { DrPhonePipe } from '../../core/pipes/dr-phone.pipe';
import { DrCedulaPipe } from '../../core/pipes/dr-cedula.pipe';
import { DrPhoneMaskDirective } from '../../core/ui/masks/dr-phone-mask.directive';
import { DrCedulaMaskDirective } from '../../core/ui/masks/dr-cedula-mask.directive';

@Component({
  selector: 'app-participants',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SpinnerComponent,
    FormatDateTimePipe,
    MatIconModule,
    ConfirmDialogComponent,
    DrPhonePipe,
    DrCedulaPipe,
    DrPhoneMaskDirective,
    DrCedulaMaskDirective,
  ],
  templateUrl: './participants.component.html',
  styleUrl: './participants.component.css',
})
export class ParticipantsComponent implements OnInit {
  readonly participantsLoading = signal(false);
  readonly participantsError = signal<string | null>(null);
  readonly participants = signal<Participant[]>([]);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(15);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly totalParticipants = signal(0);
  readonly deletingParticipantId = signal<number | null>(null);
  readonly deleteConfirmOpen = signal(false);
  readonly deleteTarget = signal<Participant | null>(null);
  readonly modalOpen = signal(false);
  readonly modalMode = signal<'create' | 'edit'>('edit');
  readonly modalSubmitting = signal(false);
  readonly modalError = signal<string | null>(null);
  readonly activeParticipantId = signal<number | null>(null);
  participantForm!: FormGroup;

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

  readonly deleteConfirmMessage = computed(() => {
    const p = this.deleteTarget();
    return p
      ? `¿Eliminar a ${p.name}? Esta accion no se puede deshacer.`
      : '';
  });

  constructor(
    private readonly participantsService: ParticipantsService,
    private readonly fb: FormBuilder,
    private readonly toast: ToastService,
  ) {
    this.searchReload.pipe(debounceTime(350), takeUntilDestroyed()).subscribe(() => {
      this.currentPage.set(1);
      const term = this.searchTerm().trim();
      if (!term) {
        this.loadParticipantsPage(1);
      } else {
        this.loadSearchPage(1);
      }
    });
  }

  /** Texto para columna Valoración (segment_label del API o segment formateado). */
  participantValuationLabel(p: Participant): string {
    const label = String(p.segment_label ?? p.segmentLabel ?? '').trim();
    if (label) return label;
    const seg = String(p.segment ?? '').trim().toLowerCase();
    if (!seg) return '—';
    return seg.charAt(0).toUpperCase() + seg.slice(1);
  }

  ngOnInit(): void {
    this.participantForm = this.fb.group({
      name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
      cedula: this.fb.nonNullable.control(''),
      phone: this.fb.nonNullable.control(''),
      email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    });
    this.loadParticipants();
  }

  /** Listado paginado o búsqueda según haya texto en el buscador. */
  loadParticipants(page: number = this.currentPage()): void {
    if (this.searchTerm().trim()) {
      this.loadSearchPage(page);
    } else {
      this.loadParticipantsPage(page);
    }
  }

  private loadParticipantsPage(page: number): void {
    this.participantsLoading.set(true);
    this.participantsError.set(null);
    this.participantsService
      .listParticipants(page, 15)
      .pipe(finalize(() => this.participantsLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.applyPaginatedResponse(res, page);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible cargar los participantes.';
          this.participantsError.set(String(message));
        },
      });
  }

  /** GET /api/participants/search — filtro en servidor. */
  private loadSearchPage(page: number): void {
    const q = this.searchTerm().trim();
    if (!q.length) {
      this.loadParticipantsPage(1);
      return;
    }
    this.participantsLoading.set(true);
    this.participantsError.set(null);
    this.participantsService
      .searchParticipants(q, page, 15)
      .pipe(finalize(() => this.participantsLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.applyPaginatedResponse(res, page);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible buscar participantes.';
          this.participantsError.set(String(message));
        },
      });
  }

  private applyPaginatedResponse(res: PaginatedParticipantsResponse, page: number): void {
    const data = res.data ?? [];
    this.participants.set(data);
    this.currentPage.set(res.current_page ?? page);
    this.lastPage.set(res.last_page ?? 1);
    this.perPage.set(res.per_page ?? 15);
    this.fromItem.set(res.from ?? 0);
    this.toItem.set(res.to ?? 0);
    this.totalParticipants.set(res.total ?? 0);
  }

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
    this.searchReload.next();
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.searchReload.next();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.currentPage()) return;
    this.loadParticipants(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  openEditParticipant(participant: Participant): void {
    this.modalMode.set('edit');
    this.modalError.set(null);
    this.participantsLoading.set(true);
    this.participantsService
      .getParticipant(participant.id)
      .pipe(finalize(() => this.participantsLoading.set(false)))
      .subscribe({
        next: (detail) => {
          this.activeParticipantId.set(detail.id);
          this.participantForm.reset({
            name: detail.name ?? '',
            cedula: detail.cedula ?? '',
            phone: detail.phone ?? '',
            email: detail.email ?? '',
          });
          this.modalOpen.set(true);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible obtener el participante.';
          this.participantsError.set(String(message));
        },
      });
  }

  openCreateParticipant(): void {
    this.modalMode.set('create');
    this.modalError.set(null);
    this.activeParticipantId.set(null);
    this.participantForm.reset({
      name: '',
      cedula: '',
      phone: '',
      email: '',
    });
    this.modalOpen.set(true);
  }

  closeModal(force: boolean = false): void {
    if (!force && this.modalSubmitting()) return;
    this.modalOpen.set(false);
    this.modalError.set(null);
    this.activeParticipantId.set(null);
  }

  saveParticipant(): void {
    if (this.participantForm.invalid || this.modalSubmitting()) return;

    this.modalSubmitting.set(true);
    this.modalError.set(null);

    const value = this.participantForm.getRawValue();
    const cedulaDigits = digitsOnly(value.cedula);
    const phoneDigits = digitsOnly(value.phone);
    const payload: ParticipantPayload = {
      name: value.name,
      cedula: cedulaDigits ? cedulaDigits : null,
      phone: phoneDigits ? phoneDigits : null,
      email: value.email,
    };

    const isCreate = this.modalMode() === 'create';
    const request$ = isCreate
      ? this.participantsService.createParticipant(payload)
      : this.participantsService.updateParticipant(this.activeParticipantId() as number, payload);

    request$
      .pipe(finalize(() => this.modalSubmitting.set(false)))
      .subscribe({
        next: (res) => {
          this.toast.successFromApiResponse(
            res,
            isCreate ? 'Participante creado con éxito' : 'Guardado con éxito',
          );
          this.closeModal(true);
          this.loadParticipants();
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            (isCreate
              ? 'No fue posible crear el participante.'
              : 'No fue posible actualizar el participante.');
          this.modalError.set(String(message));
        },
      });
  }

  deleteParticipant(participant: Participant): void {
    if (this.deletingParticipantId() === participant.id) return;
    this.deleteTarget.set(participant);
    this.deleteConfirmOpen.set(true);
  }

  closeDeleteConfirm(): void {
    if (this.deletingParticipantId() !== null) return;
    this.deleteConfirmOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDeleteParticipant(): void {
    const participant = this.deleteTarget();
    if (!participant || this.deletingParticipantId() === participant.id) return;
    this.deletingParticipantId.set(participant.id);
    this.participantsService
      .deleteParticipant(participant.id)
      .pipe(finalize(() => this.deletingParticipantId.set(null)))
      .subscribe({
        next: (res) => {
          this.toast.successFromApiResponse(res, 'Participante eliminado con éxito');
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
          this.loadParticipants();
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible eliminar el participante.';
          this.participantsError.set(String(message));
          this.toast.error(String(message));
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
        },
      });
  }
}
