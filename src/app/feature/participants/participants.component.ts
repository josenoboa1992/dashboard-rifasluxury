import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import {
  Participant,
  ParticipantPayload,
  ParticipantsService,
} from '../../core/participants/services/participants.service';

@Component({
  selector: 'app-participants',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SpinnerComponent],
  templateUrl: './participants.component.html',
  styleUrl: './participants.component.css',
})
export class ParticipantsComponent {
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
  readonly modalOpen = signal(false);
  readonly modalMode = signal<'create' | 'edit'>('edit');
  readonly modalSubmitting = signal(false);
  readonly modalError = signal<string | null>(null);
  readonly activeParticipantId = signal<number | null>(null);
  participantForm!: FormGroup;

  readonly visibleParticipants = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.participants();
    return this.participants().filter((participant) => {
      const haystack =
        `${participant.name} ${participant.email} ${participant.phone ?? ''} ${participant.cedula ?? ''}`.toLowerCase();
      return haystack.includes(term);
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

  constructor(
    private readonly participantsService: ParticipantsService,
    private readonly fb: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.participantForm = this.fb.group({
      name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
      cedula: this.fb.nonNullable.control(''),
      phone: this.fb.nonNullable.control(''),
      email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
    });
    this.loadParticipants();
  }

  loadParticipants(page: number = this.currentPage()): void {
    this.participantsLoading.set(true);
    this.participantsError.set(null);
    this.participantsService
      .listParticipants(page, this.perPage())
      .pipe(finalize(() => this.participantsLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.participants.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 15);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.totalParticipants.set(res.total ?? 0);
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

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
  }

  clearSearch(): void {
    this.searchTerm.set('');
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

  closeModal(): void {
    if (this.modalSubmitting()) return;
    this.modalOpen.set(false);
    this.modalError.set(null);
    this.activeParticipantId.set(null);
  }

  saveParticipant(): void {
    if (this.participantForm.invalid || this.modalSubmitting()) return;

    this.modalSubmitting.set(true);
    this.modalError.set(null);

    const value = this.participantForm.getRawValue();
    const payload: ParticipantPayload = {
      name: value.name,
      cedula: value.cedula?.trim() ? value.cedula : null,
      phone: value.phone?.trim() ? value.phone : null,
      email: value.email,
    };

    const isCreate = this.modalMode() === 'create';
    const request$ = isCreate
      ? this.participantsService.createParticipant(payload)
      : this.participantsService.updateParticipant(this.activeParticipantId() as number, payload);

    request$
      .pipe(finalize(() => this.modalSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.closeModal();
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
    const confirmed = window.confirm(`¿Eliminar a ${participant.name}? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    this.deletingParticipantId.set(participant.id);
    this.participantsService
      .deleteParticipant(participant.id)
      .pipe(finalize(() => this.deletingParticipantId.set(null)))
      .subscribe({
        next: () => this.loadParticipants(),
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible eliminar el participante.';
          this.participantsError.set(String(message));
        },
      });
  }
}

