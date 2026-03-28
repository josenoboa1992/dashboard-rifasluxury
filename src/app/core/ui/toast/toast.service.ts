import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);

  private readonly durationMs = 4000;
  private readonly durationErrorMs = 5500;

  success(message = 'Guardado con éxito'): void {
    this.snackBar.open(message, 'Cerrar', {
      duration: this.durationMs,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      panelClass: ['app-toast', 'app-toast-success'],
    });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Cerrar', {
      duration: this.durationErrorMs,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      panelClass: ['app-toast', 'app-toast-error'],
    });
  }

  /** Usa `message` o `detail` del JSON del API si vienen; si no, el texto por defecto. */
  successFromApiResponse(body: unknown, fallback: string): void {
    const fromApi = this.readApiMessage(body);
    this.success(fromApi ?? fallback);
  }

  private readApiMessage(data: unknown): string | null {
    if (data == null || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    const msg = o['message'];
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    const detail = o['detail'];
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
    return null;
  }
}
