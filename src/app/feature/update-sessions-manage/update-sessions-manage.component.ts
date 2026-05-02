import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs/operators';
import { QuillEditorComponent } from 'ngx-quill';

import { AdminUpdateSessionsService } from '../../core/update-sessions/services/admin-update-sessions.service';
import type { AdminUpdateSessionRow } from '../../core/update-sessions/models/update-session.model';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { UpdateSessionsService } from '../../core/update-sessions/services/update-sessions.service';

@Component({
  selector: 'app-update-sessions-manage',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormatDateTimePipe,
    SpinnerComponent,
    QuillEditorComponent,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatSelectModule,
  ],
  templateUrl: './update-sessions-manage.component.html',
  styleUrl: './update-sessions-manage.component.css',
})
export class UpdateSessionsManageComponent implements OnInit {
  private readonly admin = inject(AdminUpdateSessionsService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly publicUpdates = inject(UpdateSessionsService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly rows = signal<AdminUpdateSessionRow[]>([]);
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);

  readonly modalOpen = signal(false);
  readonly editingId = signal<number | null>(null);

  readonly hours12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);
  compareNumericSelect = (a: unknown, b: unknown): boolean => Number(a) === Number(b);

  readonly form = this.fb.group({
    title: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(255)]),
    body: this.fb.nonNullable.control('', [Validators.required]),
    /** Misma UX que rifas: fecha (Material) + hora 12 h + a.m./p.m. */
    published_at_date: this.fb.control<Date | null>(null),
    published_at_hour: this.fb.nonNullable.control(12, [Validators.min(1), Validators.max(12)]),
    published_at_minute: this.fb.nonNullable.control(0, [Validators.min(0), Validators.max(59)]),
    published_at_ampm: this.fb.nonNullable.control<'am' | 'pm'>('pm'),
  });

  ngOnInit(): void {
    this.load(1);
  }

  load(page: number): void {
    this.loading.set(true);
    this.admin
      .list(page, 25)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.rows.set(res.data ?? []);
          this.currentPage.set(Math.max(1, Number(res.current_page) || 1));
          this.lastPage.set(Math.max(1, Number(res.last_page) || 1));
        },
        error: () => this.toast.error('No se pudieron cargar las sesiones.'),
      });
  }

  openCreate(): void {
    this.editingId.set(null);
    this.form.reset({
      title: '',
      body: '',
      ...this.nowPublishDefaults(),
    });
    this.modalOpen.set(true);
  }

  openEdit(row: AdminUpdateSessionRow): void {
    this.admin.get(row.id).subscribe({
      next: (r) => {
        this.editingId.set(r.id);
        if (r.published_at) {
          const { date, time } = this.parseIsoToDateAndTime(String(r.published_at));
          const parts = this.partsFromTime24(time);
          this.form.patchValue({
            title: r.title,
            body: r.body ?? '',
            published_at_date: date,
            published_at_hour: parts.hour,
            published_at_minute: parts.minute,
            published_at_ampm: parts.ampm,
          });
        } else {
          this.form.patchValue({
            title: r.title,
            body: r.body ?? '',
            ...this.nowPublishDefaults(),
          });
        }
        this.modalOpen.set(true);
      },
      error: () => this.toast.error('No se pudo cargar la sesión.'),
    });
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingId.set(null);
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const { title, body, published_at_date } = this.form.getRawValue();
    let pub: string | null = null;
    if (published_at_date instanceof Date && !Number.isNaN(published_at_date.getTime())) {
      const iso = this.combineDateTimeToApi(published_at_date, this.getPublishedTime24());
      pub = iso.trim() ? iso : null;
    }
    const id = this.editingId();
    this.saving.set(true);
    const onOk = () => {
      this.closeModal();
      this.load(this.currentPage());
      this.publicUpdates.refreshUnreadCount();
    };
    if (id == null) {
      this.admin
        .create({ title, body, published_at: pub })
        .pipe(finalize(() => this.saving.set(false)))
        .subscribe({
          next: () => {
            this.toast.success('Actualización creada.');
            onOk();
          },
          error: (err: unknown) => this.toast.error(this.apiErr(err, 'No se pudo crear.')),
        });
    } else {
      this.admin
        .patch(id, { title, body, published_at: pub })
        .pipe(finalize(() => this.saving.set(false)))
        .subscribe({
          next: () => {
            this.toast.success('Actualización guardada.');
            onOk();
          },
          error: (err: unknown) => this.toast.error(this.apiErr(err, 'No se pudo guardar.')),
        });
    }
  }

  confirmDelete(row: AdminUpdateSessionRow): void {
    if (!confirm(`¿Eliminar «${row.title}»? Esta acción no se puede deshacer.`)) return;
    this.admin.delete(row.id).subscribe({
      next: () => {
        this.toast.success('Eliminada.');
        this.load(this.currentPage());
        this.publicUpdates.refreshUnreadCount();
      },
      error: () => this.toast.error('No se pudo eliminar.'),
    });
  }

  goPage(p: number): void {
    this.load(Math.min(this.lastPage(), Math.max(1, p)));
  }

  minuteLabel(m: number): string {
    return String(m).padStart(2, '0');
  }

  /** Fecha y hora local actuales para «Publicar el» al crear o editar borrador. */
  private nowPublishDefaults(): {
    published_at_date: Date;
    published_at_hour: number;
    published_at_minute: number;
    published_at_ampm: 'am' | 'pm';
  } {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const parts = this.partsFromTime24(time);
    const dateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return {
      published_at_date: dateOnly,
      published_at_hour: parts.hour,
      published_at_minute: parts.minute,
      published_at_ampm: parts.ampm,
    };
  }

  private parseIsoToDateAndTime(iso: string | null | undefined): { date: Date | null; time: string } {
    if (iso == null || String(iso).trim() === '') return { date: null, time: '00:00' };
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: null, time: '00:00' };
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { date: dateOnly, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }

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

  private getPublishedTime24(): string {
    const v = this.form.getRawValue();
    const apRaw = String(v.published_at_ampm ?? '').toLowerCase();
    const ap: 'am' | 'pm' = apRaw === 'am' || apRaw === 'pm' ? apRaw : 'am';
    return this.time24FromAmPm(Number(v.published_at_hour), Number(v.published_at_minute), ap);
  }

  /** Fecha/hora local del formulario → ISO 8601 (UTC) para el API. */
  private combineDateTimeToApi(date: Date, time: string): string {
    const parts = (time || '00:00').split(':');
    const h = parseInt(parts[0] ?? '0', 10) || 0;
    const m = parseInt(parts[1] ?? '0', 10) || 0;
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
  }

  private apiErr(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string } };
    const m = e?.error?.message;
    return typeof m === 'string' && m.trim() ? m.trim() : fallback;
  }
}
