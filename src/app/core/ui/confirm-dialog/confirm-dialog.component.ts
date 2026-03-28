import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (open) {
      <div class="confirm-backdrop" role="presentation" (click)="onCancel()">
        <div class="confirm-card" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <h3>{{ title }}</h3>
          <p>{{ message }}</p>
          <div class="confirm-actions">
            <button type="button" class="btn btn-ghost" (click)="onCancel()" [disabled]="loading">
              {{ cancelText }}
            </button>
            <button type="button" class="btn btn-danger" (click)="onConfirm()" [disabled]="loading">
              @if (loading) { Eliminando... } @else { {{ confirmText }} }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .confirm-backdrop {
        position: fixed;
        inset: 0;
        background: rgb(4 5 122 / 0.45);
        backdrop-filter: blur(3px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        z-index: 10050;
      }
      .confirm-card {
        width: 100%;
        max-width: 28rem;
        background: #fff;
        border: 1px solid #e6e8ed;
        border-radius: 0.9rem;
        padding: 1rem;
      }
      h3 {
        margin: 0;
        color: #04057a;
        font-size: 1.05rem;
      }
      p {
        margin: 0.65rem 0 0;
        color: #4f5565;
        font-weight: 600;
      }
      .confirm-actions {
        margin-top: 1rem;
        padding-top: 0.8rem;
        border-top: 1px solid #e6e8ed;
        display: flex;
        justify-content: flex-end;
        gap: 0.7rem;
      }
      .btn {
        border: none;
        border-radius: 0.6rem;
        padding: 0.5rem 0.9rem;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .btn-ghost {
        background: #fff;
        color: #5c6370;
        border: 1px solid #e6e8ed;
      }
      .btn-danger {
        background: #c21112;
        color: #fff;
      }
    `,
  ],
})
export class ConfirmDialogComponent {
  @Input() open = false;
  @Input() loading = false;
  @Input() title = 'Confirmar accion';
  @Input() message = 'Desea continuar con esta accion?';
  @Input() confirmText = 'Eliminar';
  @Input() cancelText = 'Cancelar';

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onConfirm(): void {
    if (this.loading) return;
    this.confirm.emit();
  }

  onCancel(): void {
    if (this.loading) return;
    this.cancel.emit();
  }
}
