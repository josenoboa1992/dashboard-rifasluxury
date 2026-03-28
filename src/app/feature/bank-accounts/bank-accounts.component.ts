import { CommonModule } from '@angular/common';
import { Component, computed, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  BankAccount,
  BankAccountsService,
} from '../../core/bank-accounts/services/bank-accounts.service';

@Component({
  selector: 'app-bank-accounts',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SpinnerComponent,
    MatIconModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatTooltipModule,
    ConfirmDialogComponent,
  ],
  templateUrl: './bank-accounts.component.html',
  styleUrl: './bank-accounts.component.css',
})
export class BankAccountsComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly accounts = signal<BankAccount[]>([]);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);

  readonly modalOpen = signal(false);
  readonly modalMode = signal<'create' | 'view' | 'edit'>('create');
  readonly modalSubmitting = signal(false);
  readonly modalError = signal<string | null>(null);
  readonly modalDetailLoading = signal(false);
  readonly activeId = signal<number | null>(null);
  readonly selectedPhotoFile = signal<File | null>(null);
  readonly currentImageUrl = signal<string | null>(null);

  readonly deletingId = signal<number | null>(null);
  readonly deleteConfirmOpen = signal(false);
  readonly deleteTarget = signal<BankAccount | null>(null);

  accountForm!: FormGroup;

  readonly visibleAccounts = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.accounts();
    return this.accounts().filter((a) => {
      const hay = `${a.bank_name} ${a.account_type} ${a.account_number} ${a.account_holder_name} ${a.currency}`.toLowerCase();
      return hay.includes(term);
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

  readonly deleteConfirmMessage = computed(() => {
    const a = this.deleteTarget();
    return a ? `¿Eliminar la cuenta de ${a.bank_name} (${a.account_number})? Esta accion no se puede deshacer.` : '';
  });

  /** Paleta sugerida + colores comunes de banca / marca */
  readonly paletteColors = [
    '#04057a',
    '#f80203',
    '#05b8f3',
    '#1e3a8a',
    '#0f766e',
    '#7c3aed',
    '#b45309',
    '#15803d',
    '#be123c',
    '#1d4ed8',
    '#0d9488',
    '#ea580c',
    '#64748b',
    '#111827',
    '#ffffff',
  ] as const;

  private readonly defaultHexColor = '#04057a';

  constructor(
    private readonly bankAccountsService: BankAccountsService,
    private readonly fb: FormBuilder,
    private readonly toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.accountForm = this.fb.group({
      bank_name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
      account_type: this.fb.nonNullable.control('', [Validators.required]),
      account_number: this.fb.nonNullable.control('', [Validators.required]),
      account_holder_name: this.fb.nonNullable.control('', [Validators.required]),
      holder_id: this.fb.nonNullable.control(''),
      currency: this.fb.nonNullable.control('DOP'),
      is_active: this.fb.nonNullable.control(true),
      sort_order: this.fb.nonNullable.control(0, [Validators.required, Validators.min(0)]),
      color: this.fb.nonNullable.control(''),
    });
    this.loadBankAccounts();
  }

  get modalTitle(): string {
    if (this.modalMode() === 'create') return 'Nueva cuenta bancaria';
    if (this.modalMode() === 'edit') return 'Editar cuenta bancaria';
    return 'Ver cuenta bancaria';
  }

  getImageUrl(account: BankAccount): string | null {
    const u = account.image && typeof account.image === 'object' ? (account.image as { url?: string }).url : null;
    return typeof u === 'string' && u.trim() ? u : null;
  }

  normalizeHex(hex: string | null | undefined): string | null {
    if (hex == null || typeof hex !== 'string') return null;
    const t = hex.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t.toLowerCase();
    if (/^#[0-9A-Fa-f]{3}$/.test(t)) {
      const r = t[1];
      const g = t[2];
      const b = t[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return null;
  }

  /** Valor para `<input type="color">` (siempre 6 hex). */
  colorPickerValue(): string {
    return this.normalizeHex(this.accountForm?.get('color')?.value) ?? this.defaultHexColor;
  }

  onNativeColorInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.accountForm.patchValue({ color: v });
  }

  pickPaletteColor(hex: string): void {
    if (this.modalMode() === 'view') return;
    this.accountForm.patchValue({ color: hex });
    this.accountForm.get('color')?.markAsDirty();
  }

  isPaletteActive(hex: string): boolean {
    const cur = this.normalizeHex(this.accountForm?.get('color')?.value);
    return cur === hex.toLowerCase();
  }

  /** Color para swatch / avatar fallback en tabla */
  accountRowColor(account: BankAccount): string {
    return this.normalizeHex(account.color) ?? '#94a3b8';
  }

  bankInitialLabel(name: string): string {
    const c = (name || '?').trim().charAt(0).toUpperCase();
    return c || '?';
  }

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
  }

  clearSearch(): void {
    this.searchTerm.set('');
  }

  loadBankAccounts(page: number = this.currentPage()): void {
    this.loading.set(true);
    this.error.set(null);
    this.bankAccountsService
      .listBankAccounts(page, this.perPage())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.accounts.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 25);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.total.set(res.total ?? 0);
        },
        error: (err) => {
          this.error.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible cargar las cuentas bancarias.'),
          );
        },
      });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.lastPage() || page === this.currentPage()) return;
    this.loadBankAccounts(page);
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
    this.selectedPhotoFile.set(null);
    this.currentImageUrl.set(null);
    this.accountForm.enable();
    this.accountForm.reset({
      bank_name: '',
      account_type: '',
      account_number: '',
      account_holder_name: '',
      holder_id: '',
      currency: 'DOP',
      is_active: true,
      sort_order: 0,
      color: '',
    });
    this.modalOpen.set(true);
  }

  openView(account: BankAccount): void {
    this.modalMode.set('view');
    this.loadDetailAndOpen(account.id, true);
  }

  openEdit(account: BankAccount): void {
    this.modalMode.set('edit');
    this.loadDetailAndOpen(account.id, false);
  }

  private loadDetailAndOpen(id: number, disableForm: boolean): void {
    this.modalError.set(null);
    this.modalDetailLoading.set(true);
    this.bankAccountsService
      .getBankAccount(id)
      .pipe(finalize(() => this.modalDetailLoading.set(false)))
      .subscribe({
        next: (detail) => {
          this.activeId.set(detail.id);
          this.selectedPhotoFile.set(null);
          this.currentImageUrl.set(this.getImageUrl(detail));
          this.accountForm.patchValue({
            bank_name: detail.bank_name ?? '',
            account_type: detail.account_type ?? '',
            account_number: detail.account_number ?? '',
            account_holder_name: detail.account_holder_name ?? '',
            holder_id: detail.holder_id ?? '',
            currency: detail.currency ?? 'DOP',
            is_active: !!detail.is_active,
            sort_order: detail.sort_order ?? 0,
            color: detail.color ?? '',
          });
          if (disableForm) this.accountForm.disable();
          else this.accountForm.enable();
          this.modalOpen.set(true);
        },
        error: (err) => {
          this.error.set(
            String(err?.error?.message || err?.error?.detail || 'No fue posible obtener la cuenta.'),
          );
        },
      });
  }

  closeModal(force: boolean = false): void {
    if (!force && this.modalSubmitting()) return;
    this.modalOpen.set(false);
    this.modalError.set(null);
    this.activeId.set(null);
    this.selectedPhotoFile.set(null);
    this.currentImageUrl.set(null);
    this.accountForm.enable();
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files && input.files.length ? input.files[0] : null;
    this.selectedPhotoFile.set(file);
  }

  private buildFormData(): FormData {
    const v = this.accountForm.getRawValue() as Record<string, unknown>;
    const fd = new FormData();
    fd.set('bank_name', String(v['bank_name'] ?? ''));
    fd.set('account_type', String(v['account_type'] ?? ''));
    fd.set('account_number', String(v['account_number'] ?? ''));
    fd.set('account_holder_name', String(v['account_holder_name'] ?? ''));
    const hid = String(v['holder_id'] ?? '').trim();
    if (hid) fd.set('holder_id', hid);
    fd.set('currency', String(v['currency'] ?? 'DOP').trim() || 'DOP');
    fd.set('is_active', v['is_active'] ? '1' : '0');
    fd.set('sort_order', String(Number(v['sort_order'] ?? 0)));
    const col = String(v['color'] ?? '').trim();
    if (col) fd.set('color', col);
    const photo = this.selectedPhotoFile();
    if (photo) fd.set('photo', photo, photo.name);
    return fd;
  }

  save(): void {
    if (this.modalMode() === 'view') {
      this.closeModal();
      return;
    }
    if (this.accountForm.invalid || this.modalSubmitting()) {
      this.accountForm.markAllAsTouched();
      return;
    }

    const isCreate = this.modalMode() === 'create';
    const formData = this.buildFormData();

    this.modalSubmitting.set(true);
    this.modalError.set(null);

    const request$ = isCreate
      ? this.bankAccountsService.createBankAccount(formData)
      : this.bankAccountsService.updateBankAccountPost(this.activeId() as number, formData);

    request$
      .pipe(finalize(() => this.modalSubmitting.set(false)))
      .subscribe({
        next: (res) => {
          this.toast.successFromApiResponse(
            res,
            isCreate ? 'Cuenta bancaria creada con éxito' : 'Guardado con éxito',
          );
          this.closeModal(true);
          this.loadBankAccounts();
        },
        error: (err) => {
          const msg =
            err?.error?.message ||
            err?.error?.detail ||
            (isCreate ? 'No fue posible crear la cuenta.' : 'No fue posible actualizar la cuenta.');
          this.modalError.set(String(msg));
          this.toast.error(String(msg));
        },
      });
  }

  remove(account: BankAccount): void {
    if (this.deletingId() === account.id) return;
    this.deleteTarget.set(account);
    this.deleteConfirmOpen.set(true);
  }

  closeDeleteConfirm(): void {
    if (this.deletingId() !== null) return;
    this.deleteConfirmOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDelete(): void {
    const account = this.deleteTarget();
    if (!account || this.deletingId() === account.id) return;
    this.deletingId.set(account.id);
    this.bankAccountsService
      .deleteBankAccount(account.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: () => {
          this.toast.success('Cuenta eliminada con éxito');
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
          this.loadBankAccounts();
        },
        error: (err) => {
          const msg = String(err?.error?.message || err?.error?.detail || 'No fue posible eliminar la cuenta.');
          this.error.set(msg);
          this.toast.error(msg);
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
        },
      });
  }

  isInvalid(name: string): boolean {
    const c = this.accountForm.controls[name];
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  getErrorMessage(name: string): string {
    const c = this.accountForm.controls[name];
    if (!c?.errors) return '';
    if (c.errors['required']) return 'Campo obligatorio.';
    if (c.errors['minlength']) return 'Texto demasiado corto.';
    if (c.errors['min']) return 'Valor invalido.';
    return 'Valor invalido.';
  }
}
