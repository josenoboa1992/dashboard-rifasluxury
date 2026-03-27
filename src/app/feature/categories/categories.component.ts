import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import {
  CategoryPayload,
  CategoriesService,
  Category,
} from '../../core/categories/services/categories.service';

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SpinnerComponent],
  templateUrl: './categories.component.html',
  styleUrl: './categories.component.css',
})
export class CategoriesComponent {
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly categories = signal<Category[]>([]);
  readonly searchTerm = signal('');
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly perPage = signal(25);
  readonly fromItem = signal(0);
  readonly toItem = signal(0);
  readonly total = signal(0);
  readonly deletingCategoryId = signal<number | null>(null);
  readonly modalOpen = signal(false);
  readonly modalMode = signal<'create' | 'view' | 'edit'>('create');
  readonly modalSubmitting = signal(false);
  readonly modalError = signal<string | null>(null);
  readonly activeCategoryId = signal<number | null>(null);
  categoryForm!: FormGroup;

  readonly visibleCategories = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.categories();
    return this.categories().filter((category) => {
      const haystack =
        `${category.id} ${category.name ?? ''} ${category.title ?? ''} ${category.slug ?? ''}`.toLowerCase();
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
    private readonly categoriesService: CategoriesService,
    private readonly fb: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.categoryForm = this.fb.group({
      name: this.fb.nonNullable.control('', [Validators.required, Validators.minLength(2)]),
      slug: this.fb.nonNullable.control(''),
    });
    this.loadCategories();
  }

  getCategoryName(category: Category): string {
    const name = category.name ?? category.title;
    return typeof name === 'string' && name.trim() ? name : '-';
  }

  loadCategories(page: number = this.currentPage()): void {
    this.loading.set(true);
    this.error.set(null);
    this.categoriesService
      .listCategories(page, this.perPage())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (res) => {
          this.categories.set(res.data ?? []);
          this.currentPage.set(res.current_page ?? page);
          this.lastPage.set(res.last_page ?? 1);
          this.perPage.set(res.per_page ?? 25);
          this.fromItem.set(res.from ?? 0);
          this.toItem.set(res.to ?? 0);
          this.total.set(res.total ?? 0);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible cargar las categorías.';
          this.error.set(String(message));
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
    this.loadCategories(page);
  }

  goPrevPage(): void {
    this.goToPage(this.currentPage() - 1);
  }

  goNextPage(): void {
    this.goToPage(this.currentPage() + 1);
  }

  openCreateCategory(): void {
    this.modalMode.set('create');
    this.modalError.set(null);
    this.activeCategoryId.set(null);
    this.categoryForm.enable();
    this.categoryForm.reset({
      name: '',
      slug: '',
    });
    this.modalOpen.set(true);
  }

  openViewCategory(category: Category): void {
    this.modalMode.set('view');
    this.openCategoryModalWithDetail(category.id, true);
  }

  openEditCategory(category: Category): void {
    this.modalMode.set('edit');
    this.openCategoryModalWithDetail(category.id, false);
  }

  private openCategoryModalWithDetail(categoryId: number, disableForm: boolean): void {
    this.modalError.set(null);
    this.loading.set(true);
    this.categoriesService
      .getCategory(categoryId)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (detail) => {
          this.activeCategoryId.set(detail.id);
          this.categoryForm.reset({
            name: this.getCategoryName(detail) === '-' ? '' : this.getCategoryName(detail),
            slug: typeof detail.slug === 'string' ? detail.slug : '',
          });
          if (disableForm) {
            this.categoryForm.disable();
          } else {
            this.categoryForm.enable();
          }
          this.modalOpen.set(true);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible obtener la categoria.';
          this.error.set(String(message));
        },
      });
  }

  closeModal(): void {
    if (this.modalSubmitting()) return;
    this.modalOpen.set(false);
    this.modalError.set(null);
    this.activeCategoryId.set(null);
    this.categoryForm.enable();
  }

  saveCategory(): void {
    if (this.modalMode() === 'view') {
      this.closeModal();
      return;
    }
    if (this.categoryForm.invalid || this.modalSubmitting()) return;

    const value = this.categoryForm.getRawValue();
    const payload: CategoryPayload = {
      name: value.name,
      slug: value.slug?.trim() ? value.slug : null,
    };

    const isCreate = this.modalMode() === 'create';
    const request$ = isCreate
      ? this.categoriesService.createCategory(payload)
      : this.categoriesService.updateCategory(this.activeCategoryId() as number, payload);

    this.modalSubmitting.set(true);
    this.modalError.set(null);

    request$
      .pipe(finalize(() => this.modalSubmitting.set(false)))
      .subscribe({
        next: () => {
          this.closeModal();
          this.loadCategories();
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            (isCreate
              ? 'No fue posible crear la categoria.'
              : 'No fue posible actualizar la categoria.');
          this.modalError.set(String(message));
        },
      });
  }

  deleteCategory(category: Category): void {
    if (this.deletingCategoryId() === category.id) return;
    const confirmed = window.confirm(
      `¿Eliminar la categoria ${this.getCategoryName(category)}? Esta acción no se puede deshacer.`,
    );
    if (!confirmed) return;

    this.deletingCategoryId.set(category.id);
    this.categoriesService
      .deleteCategory(category.id)
      .pipe(finalize(() => this.deletingCategoryId.set(null)))
      .subscribe({
        next: () => this.loadCategories(),
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible eliminar la categoria.';
          this.error.set(String(message));
        },
      });
  }
}

