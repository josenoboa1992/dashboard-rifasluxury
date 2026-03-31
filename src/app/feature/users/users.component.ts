import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import { ConfirmDialogComponent } from '../../core/ui/confirm-dialog/confirm-dialog.component';
import { ToastService } from '../../core/ui/toast/toast.service';
import { MatIconModule } from '@angular/material/icon';
import { User, UserPayload, UsersService } from '../../core/users/services/users.service';
import { roleLabelEs } from '../../core/helpers/ui-labels.es';
import { digitsOnly } from '../../core/helpers/dr-phone-cedula-format';
import { DrPhonePipe } from '../../core/pipes/dr-phone.pipe';
import { DrCedulaPipe } from '../../core/pipes/dr-cedula.pipe';
import { DrPhoneMaskDirective } from '../../core/ui/masks/dr-phone-mask.directive';
import { DrCedulaMaskDirective } from '../../core/ui/masks/dr-cedula-mask.directive';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SpinnerComponent,
    MatIconModule,
    ConfirmDialogComponent,
    DrPhonePipe,
    DrCedulaPipe,
    DrPhoneMaskDirective,
    DrCedulaMaskDirective,
  ],
  templateUrl: './users.component.html',
  styleUrl: './users.component.css',
})
export class UsersComponent {
  readonly usersLoading = signal(false);
  readonly usersError = signal<string | null>(null);
  readonly users = signal<User[]>([]);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(15);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly totalUsers = signal(0);
  readonly visibleUsers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.users();
    return this.users().filter((user) => {
      const haystack = `${user.name} ${user.email} ${user.role} ${user.phone ?? ''} ${user.cedula ?? ''}`.toLowerCase();
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

  readonly userModalOpen = signal(false);
  readonly userModalMode = signal<'create' | 'edit' | 'view'>('create');
  readonly activeUserId = signal<number | null>(null);
  readonly userSubmitting = signal(false);
  readonly deletingUserId = signal<number | null>(null);
  readonly deleteConfirmOpen = signal(false);
  readonly deleteTarget = signal<User | null>(null);
  readonly formError = signal<string | null>(null);
  userForm!: FormGroup;

  readonly deleteConfirmMessage = computed(() => {
    const u = this.deleteTarget();
    return u
      ? `¿Eliminar a ${u.name}? Esta accion no se puede deshacer.`
      : '';
  });

  constructor(
    private readonly usersService: UsersService,
    private readonly fb: FormBuilder,
    private readonly toast: ToastService,
  ) {}

  get isViewMode(): boolean {
    return this.userModalMode() === 'view';
  }

  roleLabel(role: string | null | undefined): string {
    return roleLabelEs(role);
  }

  ngOnInit(): void {
    this.userForm = this.fb.group({
      name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
      cedula: this.fb.nonNullable.control(''),
      phone: this.fb.nonNullable.control(''),
      role: this.fb.nonNullable.control('admin', [Validators.required]),
      profile_image_id: this.fb.control<number | null>(null),
      email: this.fb.nonNullable.control('', [Validators.required, Validators.email]),
      password: this.fb.nonNullable.control('', [Validators.minLength(6)]),
    });
    this.loadUsers();
  }

  loadUsers(page: number = this.currentPage()): void {
    this.usersLoading.set(true);
    this.usersError.set(null);
    this.usersService
      .listUsers(page, this.perPage())
      .pipe(finalize(() => this.usersLoading.set(false)))
      .subscribe({
        next: (res) => {
          this.users.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 15);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.totalUsers.set(res.total ?? 0);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible cargar los usuarios.';
          this.usersError.set(String(message));
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
    this.loadUsers(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  openCreateUser(): void {
    this.formError.set(null);
    this.userModalMode.set('create');
    this.activeUserId.set(null);
    this.userForm.enable();
    this.userForm.reset({
      name: '',
      cedula: '',
      phone: '',
      role: 'admin',
      profile_image_id: null,
      email: '',
      password: '',
    });
    this.userForm.controls['password'].setValidators([Validators.required, Validators.minLength(6)]);
    this.userForm.controls['password'].updateValueAndValidity();
    this.userModalOpen.set(true);
  }

  openViewUser(user: User): void {
    this.usersLoading.set(true);
    this.formError.set(null);
    this.usersService
      .getUser(user.id)
      .pipe(finalize(() => this.usersLoading.set(false)))
      .subscribe({
        next: (detail) => {
          this.userModalMode.set('view');
          this.activeUserId.set(detail.id);
          this.userForm.reset({
            name: detail.name ?? '',
            cedula: detail.cedula ?? '',
            phone: detail.phone ?? '',
            role: detail.role ?? 'admin',
            profile_image_id: detail.profile_image_id ?? null,
            email: detail.email ?? '',
            password: '',
          });
          this.userForm.disable();
          this.userForm.controls['password'].clearValidators();
          this.userForm.controls['password'].setValue('');
          this.userForm.controls['password'].updateValueAndValidity();
          this.userModalOpen.set(true);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible obtener el usuario.';
          this.usersError.set(String(message));
        },
      });
  }

  openEditUser(user: User): void {
    this.usersLoading.set(true);
    this.formError.set(null);
    this.usersService
      .getUser(user.id)
      .pipe(finalize(() => this.usersLoading.set(false)))
      .subscribe({
        next: (detail) => {
          this.userModalMode.set('edit');
          this.activeUserId.set(detail.id);
          this.userForm.enable();
          this.userForm.reset({
            name: detail.name ?? '',
            cedula: detail.cedula ?? '',
            phone: detail.phone ?? '',
            role: detail.role ?? 'admin',
            profile_image_id: detail.profile_image_id ?? null,
            email: detail.email ?? '',
            password: '',
          });
          this.userForm.controls['password'].clearValidators();
          this.userForm.controls['password'].setValue('');
          this.userForm.controls['password'].updateValueAndValidity();
          this.userModalOpen.set(true);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible obtener el usuario.';
          this.usersError.set(String(message));
        },
      });
  }

  closeUserModal(force: boolean = false): void {
    if (!force && this.userSubmitting()) return;
    this.userModalOpen.set(false);
    this.userForm.enable();
    this.formError.set(null);
  }

  saveUser(): void {
    if (this.isViewMode) {
      this.closeUserModal();
      return;
    }
    if (this.userForm.invalid || this.userSubmitting()) return;

    this.userSubmitting.set(true);
    this.formError.set(null);

    const value = this.userForm.getRawValue();
    const cedulaDigits = digitsOnly(value.cedula);
    const phoneDigits = digitsOnly(value.phone);
    const payload: UserPayload = {
      name: value.name,
      cedula: cedulaDigits ? cedulaDigits : null,
      phone: phoneDigits ? phoneDigits : null,
      role: value.role,
      profile_image_id: value.profile_image_id,
      email: value.email,
      password: this.userModalMode() === 'create' ? value.password || undefined : undefined,
    };

    const isCreate = this.userModalMode() === 'create';
    const request$ = isCreate
      ? this.usersService.createUser(payload)
      : this.usersService.updateUser(this.activeUserId() as number, {
          ...payload,
          password: payload.password || undefined,
        });

    request$
      .pipe(finalize(() => this.userSubmitting.set(false)))
      .subscribe({
        next: (res) => {
          this.toast.successFromApiResponse(res, isCreate ? 'Usuario creado con éxito' : 'Guardado con éxito');
          this.closeUserModal(true);
          this.loadUsers();
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible guardar el usuario.';
          this.formError.set(String(message));
        },
      });
  }

  deleteUser(user: User): void {
    if (this.deletingUserId() === user.id) return;
    this.deleteTarget.set(user);
    this.deleteConfirmOpen.set(true);
  }

  closeDeleteConfirm(): void {
    if (this.deletingUserId() !== null) return;
    this.deleteConfirmOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDeleteUser(): void {
    const user = this.deleteTarget();
    if (!user || this.deletingUserId() === user.id) return;
    this.deletingUserId.set(user.id);
    this.usersService
      .deleteUser(user.id)
      .pipe(finalize(() => this.deletingUserId.set(null)))
      .subscribe({
        next: (res) => {
          this.toast.successFromApiResponse(res, 'Usuario eliminado con éxito');
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
          this.loadUsers();
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible eliminar el usuario.';
          this.usersError.set(String(message));
          this.toast.error(String(message));
          this.deleteConfirmOpen.set(false);
          this.deleteTarget.set(null);
        },
      });
  }
}

