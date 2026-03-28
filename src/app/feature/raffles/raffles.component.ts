import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, signal } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import {
  Raffle,
  RafflePayload,
  RafflesService,
} from '../../core/raffles/services/raffles.service';
import { CategoriesService, Category } from '../../core/categories/services/categories.service';
import { formatMoneyDop } from '../../core/helpers/money-format.helper';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { FormatMoneyPipe } from '../../core/pipes/format-money.pipe';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';

type RaffleTimePrefix = 'starts_at' | 'ends_at' | 'draw_at';

@Component({
  selector: 'app-raffles',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SpinnerComponent,
    ConfirmDialogComponent,
    FormatDateTimePipe,
    FormatMoneyPipe,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatSelectModule,
  ],
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
  readonly deleteModalOpen = signal(false);
  readonly deleteTarget = signal<Raffle | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly categoriesLoading = signal(false);
  readonly categoriesError = signal<string | null>(null);
  readonly ticketsOpen = signal(false);
  readonly ticketsLoading = signal(false);
  readonly ticketsError = signal<string | null>(null);
  readonly tickets = signal<string[]>([]);
  readonly ticketGoal = signal(0);
  readonly ticketDigitCount = signal(4);
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

  /** Horas 1–12 para selector a.m./p.m. */
  readonly hours12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);

  compareNumericSelect = (a: unknown, b: unknown): boolean => Number(a) === Number(b);

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

  readonly ticketChips = computed(() => {
    const goal = this.ticketGoal();
    const page = this.ticketsCurrentPage();
    const perPage = this.ticketsPerPage();
    if (goal <= 0) return [] as Array<{ number: string; available: boolean }>;

    const availableSet = new Set(this.tickets());
    const start = (page - 1) * perPage + 1;
    const end = Math.min(goal, start + perPage - 1);
    const chips: Array<{ number: string; available: boolean }> = [];

    for (let i = start; i <= end; i += 1) {
      const number = String(i).padStart(this.ticketDigitCount(), '0');
      chips.push({ number, available: availableSet.has(number) });
    }
    return chips;
  });

  constructor(
    private readonly rafflesService: RafflesService,
    private readonly categoriesService: CategoriesService,
    private readonly fb: FormBuilder,
    private readonly toast: ToastService,
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
      starts_at_date: this.fb.control<Date | null>(null, [Validators.required]),
      starts_at_hour: this.fb.nonNullable.control(9, [Validators.required, Validators.min(1), Validators.max(12)]),
      starts_at_minute: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0), Validators.max(59)]),
      starts_at_ampm: this.fb.nonNullable.control<'am' | 'pm'>('am', [Validators.required]),
      ends_at_date: this.fb.control<Date | null>(null, [Validators.required]),
      ends_at_hour: this.fb.nonNullable.control(6, [Validators.required, Validators.min(1), Validators.max(12)]),
      ends_at_minute: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0), Validators.max(59)]),
      ends_at_ampm: this.fb.nonNullable.control<'am' | 'pm'>('pm', [Validators.required]),
      draw_at_date: this.fb.control<Date | null>(null, [Validators.required]),
      draw_at_hour: this.fb.nonNullable.control(8, [Validators.required, Validators.min(1), Validators.max(12)]),
      draw_at_minute: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0), Validators.max(59)]),
      draw_at_ampm: this.fb.nonNullable.control<'am' | 'pm'>('pm', [Validators.required]),
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
    const price = this.raffleForm?.getRawValue()?.ticket_price;
    const formatted = formatMoneyDop(price);
    return formatted
      ? `${formatted} por ticket. Consulta la informacion de la rifa.`
      : 'Consulta la informacion de la rifa.';
  }

  /** Fecha mínima para "Fin" (mismo día que inicio o posterior). */
  get minDateForEnds(): Date | null {
    const v = this.raffleForm?.controls['starts_at_date']?.value as Date | null;
    return v ? new Date(v.getFullYear(), v.getMonth(), v.getDate()) : null;
  }

  /** Fecha mínima para "Sorteo" (mismo día que fin o posterior). */
  get minDateForDraw(): Date | null {
    const v = this.raffleForm?.controls['ends_at_date']?.value as Date | null;
    return v ? new Date(v.getFullYear(), v.getMonth(), v.getDate()) : null;
  }

  endsDateFilter = (d: Date | null): boolean => {
    const min = this.minDateForEnds;
    if (!d || !min) return true;
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return day >= min.getTime();
  };

  drawDateFilter = (d: Date | null): boolean => {
    const min = this.minDateForDraw;
    if (!d || !min) return true;
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return day >= min.getTime();
  };

  isInvalid(controlName: string): boolean {
    const control = this.raffleForm?.controls[controlName];
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  getErrorMessage(controlName: string): string {
    const control = this.raffleForm?.controls[controlName];
    if (!control || !control.errors) return '';
    if (control.errors['required']) return 'Este campo es obligatorio.';
    if (control.errors['minlength']) {
      const min = control.errors['minlength'].requiredLength;
      return `Debe tener al menos ${min} caracteres.`;
    }
    if (control.errors['min']) {
      const min = control.errors['min'].min;
      return `Debe ser mayor o igual que ${min}.`;
    }
    if (control.errors['max']) {
      const max = control.errors['max'].max;
      return `Debe ser menor o igual que ${max}.`;
    }
    return 'Valor invalido.';
  }

  minuteLabel(m: number): string {
    return String(m).padStart(2, '0');
  }

  firstTimeError(prefix: RaffleTimePrefix): string {
    const keys = [`${prefix}_hour`, `${prefix}_minute`, `${prefix}_ampm`] as const;
    for (const k of keys) {
      const msg = this.getErrorMessage(k);
      if (msg) return msg;
    }
    return '';
  }

  getDateFieldError(which: 'ends' | 'draw'): string {
    const starts = this.toTimestampFromPrefix('starts_at');
    const ends = this.toTimestampFromPrefix('ends_at');
    const draw = this.toTimestampFromPrefix('draw_at');
    const endsTouched =
      (this.raffleForm?.controls['ends_at_date']?.touched ||
        this.raffleForm?.controls['ends_at_hour']?.touched ||
        this.raffleForm?.controls['ends_at_minute']?.touched ||
        this.raffleForm?.controls['ends_at_ampm']?.touched) ??
      false;
    const drawTouched =
      (this.raffleForm?.controls['draw_at_date']?.touched ||
        this.raffleForm?.controls['draw_at_hour']?.touched ||
        this.raffleForm?.controls['draw_at_minute']?.touched ||
        this.raffleForm?.controls['draw_at_ampm']?.touched) ??
      false;
    if (which === 'ends' && endsTouched && !Number.isNaN(starts) && !Number.isNaN(ends) && ends < starts) {
      return 'La fecha de fin debe ser igual o posterior al inicio.';
    }
    if (which === 'draw' && drawTouched && !Number.isNaN(ends) && !Number.isNaN(draw) && draw < ends) {
      return 'La fecha de sorteo debe ser igual o posterior al fin.';
    }
    return '';
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

  private parseIsoToDateAndTime(iso: string | undefined): { date: Date | null; time: string } {
    if (!iso) return { date: null, time: '00:00' };
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: null, time: '00:00' };
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { date: dateOnly, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }

  /** Convierte hora 12 h + a.m./p.m. a cadena 24 h "HH:mm". */
  private time24FromAmPm(h12: number, minute: number, ap: string): string {
    const mi = Math.max(0, Math.min(59, Math.floor(Number(minute)) || 0));
    const h = Math.max(1, Math.min(12, Math.floor(Number(h12)) || 12));
    const apLow = String(ap).toLowerCase();
    let H: number;
    if (apLow === 'am') {
      H = h === 12 ? 0 : h;
    } else {
      H = h === 12 ? 12 : h + 12;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(H)}:${pad(mi)}`;
  }

  private partsFromTime24(time: string): { hour: number; minute: number; ampm: 'am' | 'pm' } {
    const [a, b] = (time || '00:00').split(':');
    let H = parseInt(a, 10);
    if (Number.isNaN(H)) H = 0;
    let M = parseInt(b, 10);
    if (Number.isNaN(M)) M = 0;
    const ampm: 'am' | 'pm' = H < 12 ? 'am' : 'pm';
    let h12 = H % 12;
    if (h12 === 0) h12 = 12;
    return { hour: h12, minute: M, ampm };
  }

  private getTime24(prefix: RaffleTimePrefix): string {
    const v = this.raffleForm.getRawValue() as Record<string, unknown>;
    const apRaw = String(v[`${prefix}_ampm`] ?? '').toLowerCase();
    const ap: 'am' | 'pm' = apRaw === 'am' || apRaw === 'pm' ? apRaw : 'am';
    return this.time24FromAmPm(Number(v[`${prefix}_hour`]), Number(v[`${prefix}_minute`]), ap);
  }

  private copyTimeParts(from: RaffleTimePrefix, to: RaffleTimePrefix): void {
    const v = this.raffleForm.getRawValue() as Record<string, unknown>;
    this.raffleForm.patchValue({
      [`${to}_hour`]: v[`${from}_hour`],
      [`${to}_minute`]: v[`${from}_minute`],
      [`${to}_ampm`]: v[`${from}_ampm`],
    });
  }

  /** Fecha/hora local del formulario → ISO 8601 (UTC) para el API. */
  private combineDateTimeToApi(date: Date | null, time: string): string {
    if (!date) return '';
    const parts = (time || '00:00').split(':');
    const h = parseInt(parts[0] ?? '0', 10) || 0;
    const m = parseInt(parts[1] ?? '0', 10) || 0;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  private toTimestampFromPrefix(prefix: RaffleTimePrefix): number {
    const date = this.raffleForm?.controls[`${prefix}_date`]?.value as Date | null;
    if (!date) return NaN;
    const time24 = this.getTime24(prefix);
    const [h, mi] = time24.split(':').map((x) => parseInt(x, 10));
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, mi, 0, 0).getTime();
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
      starts_at_date: null,
      starts_at_hour: 9,
      starts_at_minute: 0,
      starts_at_ampm: 'am',
      ends_at_date: null,
      ends_at_hour: 6,
      ends_at_minute: 0,
      ends_at_ampm: 'pm',
      draw_at_date: null,
      draw_at_hour: 8,
      draw_at_minute: 0,
      draw_at_ampm: 'pm',
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
            ...(() => {
              const s = this.parseIsoToDateAndTime(detail.starts_at);
              const e = this.parseIsoToDateAndTime(detail.ends_at);
              const dr = this.parseIsoToDateAndTime(detail.draw_at);
              const sp = this.partsFromTime24(s.time);
              const ep = this.partsFromTime24(e.time);
              const dp = this.partsFromTime24(dr.time);
              return {
                starts_at_date: s.date,
                starts_at_hour: sp.hour,
                starts_at_minute: sp.minute,
                starts_at_ampm: sp.ampm,
                ends_at_date: e.date,
                ends_at_hour: ep.hour,
                ends_at_minute: ep.minute,
                ends_at_ampm: ep.ampm,
                draw_at_date: dr.date,
                draw_at_hour: dp.hour,
                draw_at_minute: dp.minute,
                draw_at_ampm: dp.ampm,
              };
            })(),
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

  onStartsDateOrTimeChange(): void {
    const tsStart = this.toTimestampFromPrefix('starts_at');
    const tsEnd = this.toTimestampFromPrefix('ends_at');
    const tsDraw = this.toTimestampFromPrefix('draw_at');
    const sd = this.raffleForm.controls['starts_at_date'].value as Date | null;
    if (sd && !Number.isNaN(tsStart) && !Number.isNaN(tsEnd) && tsEnd < tsStart) {
      this.raffleForm.controls['ends_at_date'].setValue(new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()));
      this.copyTimeParts('starts_at', 'ends_at');
    }
    const tsEnd2 = this.toTimestampFromPrefix('ends_at');
    const ed = this.raffleForm.controls['ends_at_date'].value as Date | null;
    if (ed && !Number.isNaN(tsStart) && !Number.isNaN(tsDraw) && tsDraw < tsEnd2) {
      this.raffleForm.controls['draw_at_date'].setValue(new Date(ed.getFullYear(), ed.getMonth(), ed.getDate()));
      this.copyTimeParts('ends_at', 'draw_at');
    }
  }

  onEndsDateOrTimeChange(): void {
    const tsStart = this.toTimestampFromPrefix('starts_at');
    const tsEnd = this.toTimestampFromPrefix('ends_at');
    const tsDraw = this.toTimestampFromPrefix('draw_at');
    const ed = this.raffleForm.controls['ends_at_date'].value as Date | null;
    if (ed && !Number.isNaN(tsStart) && !Number.isNaN(tsEnd) && tsEnd < tsStart) {
      const sd = this.raffleForm.controls['starts_at_date'].value as Date | null;
      if (sd) {
        this.raffleForm.controls['ends_at_date'].setValue(new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()));
        this.copyTimeParts('starts_at', 'ends_at');
      }
      return;
    }
    if (ed && !Number.isNaN(tsEnd) && !Number.isNaN(tsDraw) && tsDraw < tsEnd) {
      this.raffleForm.controls['draw_at_date'].setValue(new Date(ed.getFullYear(), ed.getMonth(), ed.getDate()));
      this.copyTimeParts('ends_at', 'draw_at');
    }
  }

  save(): void {
    if (this.modalMode() === 'view') {
      this.closeModal();
      return;
    }
    if (this.raffleForm.invalid || this.modalSubmitting()) {
      this.raffleForm.markAllAsTouched();
      return;
    }

    const value = this.raffleForm.getRawValue();
    const tsStart = this.toTimestampFromPrefix('starts_at');
    const tsEnd = this.toTimestampFromPrefix('ends_at');
    const tsDraw = this.toTimestampFromPrefix('draw_at');
    if (!Number.isNaN(tsStart) && !Number.isNaN(tsEnd) && tsEnd < tsStart) {
      this.modalError.set('La fecha de fin debe ser mayor o igual que la fecha de inicio.');
      return;
    }
    if (!Number.isNaN(tsEnd) && !Number.isNaN(tsDraw) && tsDraw < tsEnd) {
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
      starts_at: this.combineDateTimeToApi(value.starts_at_date as Date | null, this.getTime24('starts_at')),
      ends_at: this.combineDateTimeToApi(value.ends_at_date as Date | null, this.getTime24('ends_at')),
      draw_at: this.combineDateTimeToApi(value.draw_at_date as Date | null, this.getTime24('draw_at')),
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
          this.toast.success(isCreate ? 'Rifa creada con éxito' : 'Rifa guardada con éxito');
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
    this.deleteTarget.set(raffle);
    this.deleteModalOpen.set(true);
  }

  closeDeleteModal(): void {
    if (this.deletingId() !== null) return;
    this.deleteModalOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const raffle = this.deleteTarget();
    if (!raffle || this.deletingId() === raffle.id) return;
    this.deletingId.set(raffle.id);
    this.rafflesService
      .deleteRaffle(raffle.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: (res) => {
          this.toast.successFromApiResponse(res, 'Rifa eliminada con éxito');
          this.deleteModalOpen.set(false);
          this.deleteTarget.set(null);
          this.loadRaffles();
        },
        error: (err) => {
          const msg = String(err?.error?.message || err?.error?.detail || 'No fue posible eliminar la rifa.');
          this.error.set(msg);
          this.toast.error(msg);
          this.deleteModalOpen.set(false);
          this.deleteTarget.set(null);
        },
      });
  }

  openAvailableTickets(raffle: Raffle): void {
    this.ticketsRaffleId.set(raffle.id);
    this.ticketsRaffleTitle.set(raffle.title);
    this.ticketsOpen.set(true);
    this.loadAvailableTickets();
  }

  closeAvailableTickets(): void {
    this.ticketsOpen.set(false);
    this.ticketsError.set(null);
    this.tickets.set([]);
    this.ticketGoal.set(0);
    this.ticketDigitCount.set(4);
  }

  loadAvailableTickets(): void {
    const raffleId = this.ticketsRaffleId();
    if (!raffleId) return;
    this.ticketsLoading.set(true);
    this.ticketsError.set(null);
    this.rafflesService.getRaffle(raffleId).subscribe({
      next: (detail) => {
        const goal = Number(detail.ticket_goal ?? 0);
        const digits = Number(detail.digit_count ?? 4);
        this.ticketGoal.set(goal);
        this.ticketDigitCount.set(digits > 0 ? digits : 4);
        this.ticketsPerPage.set(50);
        this.loadAllAvailableTickets(raffleId, 1, []);
      },
      error: (err) => {
        this.ticketsLoading.set(false);
        this.ticketsError.set(
          String(err?.error?.message || err?.error?.detail || 'No fue posible cargar la rifa.'),
        );
      },
    });
  }

  private loadAllAvailableTickets(raffleId: number, page: number, acc: string[]): void {
    this.rafflesService
      .getAvailableTickets(raffleId, page, 500)
      .pipe(finalize(() => {}))
      .subscribe({
        next: (res) => {
          const merged = [...acc, ...(res.data ?? [])];
          const currentPage = Number(res.current_page ?? page);
          const lastPage = Number(res.last_page ?? page);
          if (currentPage < lastPage) {
            this.loadAllAvailableTickets(raffleId, currentPage + 1, merged);
            return;
          }
          this.tickets.set(merged);
          const total = this.ticketGoal();
          this.ticketsLastPage.set(Math.max(1, Math.ceil(total / this.ticketsPerPage())));
          this.ticketsTotal.set(total);
          this.ticketsCurrentPage.set(0);
          this.goToTicketsPage(1);
          this.ticketsLoading.set(false);
        },
        error: (err) => {
          this.ticketsLoading.set(false);
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
    this.ticketsCurrentPage.set(page);
    const from = (page - 1) * this.ticketsPerPage() + 1;
    const to = Math.min(this.ticketGoal(), from + this.ticketsPerPage() - 1);
    this.ticketsFrom.set(this.ticketGoal() ? from : 0);
    this.ticketsTo.set(this.ticketGoal() ? to : 0);
  }

  goPrevTicketsPage(): void {
    this.goToTicketsPage(this.ticketsCurrentPage() - 1);
  }

  goNextTicketsPage(): void {
    this.goToTicketsPage(this.ticketsCurrentPage() + 1);
  }
}

