import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import {
  Raffle,
  RafflePayload,
  RafflesService,
} from '../../core/raffles/services/raffles.service';
import { CategoriesService, Category } from '../../core/categories/services/categories.service';

@Component({
  selector: 'app-raffles',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SpinnerComponent],
  templateUrl: './raffles.component.html',
  styleUrl: './raffles.component.css',
})
export class RafflesComponent {
  @ViewChild('panelError') private panelErrorRef?: ElementRef<HTMLDivElement>;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly raffles = signal<Raffle[]>([]);
  readonly searchTerm = signal('');
  readonly statusFilter = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);
  readonly deletingId = signal<number | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly categoriesLoading = signal(false);
  readonly categoriesError = signal<string | null>(null);
  readonly ticketsOpen = signal(false);
  readonly ticketsLoading = signal(false);
  readonly ticketsError = signal<string | null>(null);
  readonly tickets = signal<string[]>([]);
  readonly ticketsRaffleTitle = signal('');
  readonly ticketsCurrentPage = signal(1);
  readonly ticketsLastPage = signal(1);
  readonly ticketsPerPage = signal(50);
  readonly ticketsFrom = signal(0);
  readonly ticketsTo = signal(0);
  readonly ticketsTotal = signal(0);
  readonly ticketsRaffleId = signal<number | null>(null);

  readonly modalOpen = signal(false);
  readonly modalMode = signal<'create' | 'view' | 'edit'>('create');
  readonly modalSubmitting = signal(false);
  readonly modalError = signal<string | null>(null);
  readonly activeId = signal<number | null>(null);
  readonly selectedBannerFile = signal<File | null>(null);
  readonly currentBannerUrl = signal<string | null>(null);
  raffleForm!: FormGroup;

  readonly visibleRaffles = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.raffles();
    return this.raffles().filter((raffle) => {
      const haystack = `${raffle.id} ${raffle.title} ${raffle.status} ${raffle.ticket_price}`.toLowerCase();
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
    private readonly rafflesService: RafflesService,
    private readonly categoriesService: CategoriesService,
    private readonly fb: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.raffleForm = this.fb.group({
      category_id: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
      title: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(3)]),
      description: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(5)]),
      ticket_goal: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
      ticket_price: this.fb.nonNullable.control(0, [Validators.required, Validators.min(1)]),
      max_tickets_per_user: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
      min_tickets_per_user: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
      winners_count: this.fb.nonNullable.control(1, [Validators.required, Validators.min(1)]),
      digit_count: this.fb.nonNullable.control(4, [Validators.required, Validators.min(1)]),
      status: this.fb.nonNullable.control('draft', [Validators.required]),
      starts_at: this.fb.nonNullable.control('', [Validators.required]),
      ends_at: this.fb.nonNullable.control('', [Validators.required]),
      draw_at: this.fb.nonNullable.control('', [Validators.required]),
    });
    this.loadCategories();
    this.loadRaffles();
  }

  getCategoryName(category: Category): string {
    const name = category.name ?? category.title;
    return typeof name === 'string' && name.trim() ? name : `Categoria ${category.id}`;
  }

  getRaffleImageUrl(raffle: Raffle): string | null {
    if (typeof raffle.banner_image === 'string' && raffle.banner_image.trim()) return raffle.banner_image;
    return null;
  }

  get selectedBannerFileName(): string {
    return this.selectedBannerFile()?.name ?? 'Ningun archivo seleccionado';
  }

  get modalTitle(): string {
    if (this.modalMode() === 'create') return 'Nueva rifa';
    if (this.modalMode() === 'edit') return 'Editar rifa';
    return 'Ver rifa';
  }

  get modalSubtitle(): string {
    if (this.modalMode() === 'create') return 'Completa los datos para crear la rifa.';
    if (this.modalMode() === 'edit') return 'Actualiza los campos que necesites y guarda los cambios.';
    return 'Consulta la informacion de la rifa.';
  }

  get minEndsAt(): string {
    return this.raffleForm?.controls['starts_at']?.value || '';
  }

  get minDrawAt(): string {
    return this.raffleForm?.controls['ends_at']?.value || this.minEndsAt;
  }

  loadCategories(): void {
    this.categoriesLoading.set(true);
    this.categoriesError.set(null);
    this.categoriesService
      .listCategories(1, 200)
      .pipe(finalize(() => this.categoriesLoading.set(false)))
      .subscribe({
        next: (res) => this.categories.set(res.data ?? []),
        error: (err) => {
          this.categoriesError.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible cargar las categorias.'),
          );
        },
      });
  }

  private toDatetimeLocal(iso: string | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private toApiDatetime(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private focusGlobalError(): void {
    setTimeout(() => this.panelErrorRef?.nativeElement?.focus(), 0);
  }

  loadRaffles(page: number = this.currentPage()): void {
    this.loading.set(true);
    this.error.set(null);
    this.rafflesService
      .listRaffles(page, this.perPage(), this.statusFilter())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.raffles.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 25);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.total.set(res.total ?? 0);
        },
        error: (err) => {
          this.error.set(String(err?.error?.message || err?.error?.detail || 'No fue posible cargar las rifas.'));
        },
      });
  }

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
  }

  onStatusFilterChange(value: string): void {
    this.statusFilter.set(value);
    this.loadRaffles(1);
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.currentPage()) return;
    this.loadRaffles(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  openCreate(): void {
    this.modalMode.set('create');
    this.modalError.set(null);
    this.activeId.set(null);
    this.raffleForm.enable();
    this.raffleForm.reset({
      category_id: 0,
      title: '',
      description: '',
      ticket_goal: 0,
      ticket_price: 0,
      max_tickets_per_user: 1,
      min_tickets_per_user: 1,
      winners_count: 1,
      digit_count: 4,
      status: 'draft',
      starts_at: '',
      ends_at: '',
      draw_at: '',
    });
    this.selectedBannerFile.set(null);
    this.currentBannerUrl.set(null);
    this.modalOpen.set(true);
  }

  openView(raffle: Raffle): void {
    this.modalMode.set('view');
    this.openWithDetail(raffle.id, true);
  }

  openEdit(raffle: Raffle): void {
    this.modalMode.set('edit');
    this.openWithDetail(raffle.id, false);
  }

  private openWithDetail(id: number, disableForm: boolean): void {
    this.modalError.set(null);
    this.loading.set(true);
    this.rafflesService
      .getRaffle(id)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (detail) => {
          this.activeId.set(detail.id);
          this.raffleForm.reset({
            category_id: detail.category_id ?? 0,
            title: detail.title ?? '',
            description: detail.description ?? '',
            ticket_goal: detail.ticket_goal ?? 0,
            ticket_price: Number(detail.ticket_price ?? 0),
            max_tickets_per_user: detail.max_tickets_per_user ?? 1,
            min_tickets_per_user: detail.min_tickets_per_user ?? 1,
            winners_count: detail.winners_count ?? 1,
            digit_count: detail.digit_count ?? 4,
            status: detail.status ?? 'draft',
            starts_at: this.toDatetimeLocal(detail.starts_at),
            ends_at: this.toDatetimeLocal(detail.ends_at),
            draw_at: this.toDatetimeLocal(detail.draw_at),
          });
          this.selectedBannerFile.set(null);
          this.currentBannerUrl.set(
            typeof detail.banner_image === 'string' && detail.banner_image.trim() ? detail.banner_image : null,
          );
          if (disableForm) this.raffleForm.disable();
          else this.raffleForm.enable();
          this.modalOpen.set(true);
        },
        error: (err) => {
          this.error.set(String(err?.error?.message || err?.error?.detail || 'No fue posible obtener la rifa.'));
        },
      });
  }

  closeModal(force: boolean = false): void {
    if (!force && this.modalSubmitting()) return;
    this.modalOpen.set(false);
    this.modalError.set(null);
    this.activeId.set(null);
    this.selectedBannerFile.set(null);
    this.currentBannerUrl.set(null);
    this.raffleForm.enable();
  }

  onBannerImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    this.selectedBannerFile.set(file);
  }

  onStartsAtChange(value: string): void {
    const endsAt = this.raffleForm.controls['ends_at'].value as string;
    const drawAt = this.raffleForm.controls['draw_at'].value as string;
    if (endsAt && value && new Date(endsAt) < new Date(value)) {
      this.raffleForm.controls['ends_at'].setValue(value);
    }
    if (drawAt && value && new Date(drawAt) < new Date(value)) {
      this.raffleForm.controls['draw_at'].setValue(value);
    }
  }

  onEndsAtChange(value: string): void {
    const startsAt = this.raffleForm.controls['starts_at'].value as string;
    const drawAt = this.raffleForm.controls['draw_at'].value as string;
    if (startsAt && value && new Date(value) < new Date(startsAt)) {
      this.raffleForm.controls['ends_at'].setValue(startsAt);
      return;
    }
    if (drawAt && value && new Date(drawAt) < new Date(value)) {
      this.raffleForm.controls['draw_at'].setValue(value);
    }
  }

  save(): void {
    if (this.modalMode() === 'view') {
      this.closeModal();
      return;
    }
    if (this.raffleForm.invalid || this.modalSubmitting()) return;

    const value = this.raffleForm.getRawValue();
    if (new Date(value.ends_at) < new Date(value.starts_at)) {
      this.modalError.set('La fecha de fin debe ser mayor o igual que la fecha de inicio.');
      return;
    }
    if (new Date(value.draw_at) < new Date(value.ends_at)) {
      this.modalError.set('La fecha de sorteo debe ser mayor o igual que la fecha de fin.');
      return;
    }

    const payload: RafflePayload = {
      category_id: Number(value.category_id),
      title: value.title,
      description: value.description,
      ticket_goal: Number(value.ticket_goal),
      ticket_price: Number(value.ticket_price),
      max_tickets_per_user: Number(value.max_tickets_per_user),
      min_tickets_per_user: Number(value.min_tickets_per_user),
      winners_count: Number(value.winners_count),
      digit_count: Number(value.digit_count),
      status: value.status,
      starts_at: this.toApiDatetime(value.starts_at),
      ends_at: this.toApiDatetime(value.ends_at),
      draw_at: this.toApiDatetime(value.draw_at),
    };

    const isCreate = this.modalMode() === 'create';
    const request$ = isCreate
      ? this.rafflesService.createRaffleMultipart(payload, this.selectedBannerFile())
      : this.rafflesService.updateRaffleMultipart(this.activeId() as number, payload, this.selectedBannerFile());

    this.modalSubmitting.set(true);
    this.modalError.set(null);
    request$
      .pipe(finalize(() => this.modalSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.closeModal(true);
          this.loadRaffles();
        },
        error: (err) => {
          const fallback = isCreate
            ? 'No fue posible crear la rifa.'
            : 'No fue posible actualizar la rifa.';
          this.error.set(String(err?.error?.message || err?.error?.detail || fallback));
          this.closeModal(true);
          this.focusGlobalError();
        },
      });
  }

  remove(raffle: Raffle): void {
    if (this.deletingId() === raffle.id) return;
    const confirmed = window.confirm(`¿Eliminar la rifa "${raffle.title}"? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    this.deletingId.set(raffle.id);
    this.rafflesService
      .deleteRaffle(raffle.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: () => this.loadRaffles(),
        error: (err) => {
          this.error.set(String(err?.error?.message || err?.error?.detail || 'No fue posible eliminar la rifa.'));
        },
      });
  }

  openAvailableTickets(raffle: Raffle): void {
    this.ticketsRaffleId.set(raffle.id);
    this.ticketsRaffleTitle.set(raffle.title);
    this.ticketsOpen.set(true);
    this.loadAvailableTickets(1);
  }

  closeAvailableTickets(): void {
    this.ticketsOpen.set(false);
    this.ticketsError.set(null);
    this.tickets.set([]);
  }

  loadAvailableTickets(page: number = this.ticketsCurrentPage()): void {
    const raffleId = this.ticketsRaffleId();
    if (!raffleId) return;
    this.ticketsLoading.set(true);
    this.ticketsError.set(null);
    this.rafflesService
      .getAvailableTickets(raffleId, page, this.ticketsPerPage())
      .pipe(finalize(() => this.ticketsLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.tickets.set(res.data ?? []);
          this.ticketsCurrentPage.set(res.current_page ?? page);
          this.ticketsLastPage.set(res.last_page ?? 1);
          this.ticketsPerPage.set(res.per_page ?? 50);
          this.ticketsFrom.set(res.from ?? 0);
          this.ticketsTo.set(res.to ?? 0);
          this.ticketsTotal.set(res.total ?? 0);
        },
        error: (err) => {
          this.ticketsError.set(
            String(
              err?.error?.message ||
              err?.error?.detail ||
              'No fue posible cargar los tickets disponibles.',
            ),
          );
        },
      });
  }

  goToTicketsPage(page: number): void {
    if (page < 1 || page > this.ticketsLastPage() || page === this.ticketsCurrentPage()) return;
    this.loadAvailableTickets(page);
  }

  goPrevTicketsPage(): void {
    this.goToTicketsPage(this.ticketsCurrentPage() - 1);
  }

  goNextTicketsPage(): void {
    this.goToTicketsPage(this.ticketsCurrentPage() + 1);
  }
}

