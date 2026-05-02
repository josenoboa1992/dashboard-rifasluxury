import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';

import type { UpdateSessionDetail } from '../../core/update-sessions/models/update-session.model';
import { UpdateSessionsService } from '../../core/update-sessions/services/update-sessions.service';
import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';

@Component({
  selector: 'app-update-session-detail',
  standalone: true,
  imports: [CommonModule, FormatDateTimePipe, SpinnerComponent],
  templateUrl: './update-session-detail.component.html',
  styleUrl: './update-session-detail.component.css',
})
export class UpdateSessionDetailComponent {
  private readonly updateSessions = inject(UpdateSessionsService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  readonly sessionId = input.required<number>();

  readonly detail = signal<UpdateSessionDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly bodySafe = signal<SafeHtml>(this.sanitizer.bypassSecurityTrustHtml(''));

  constructor() {
    effect(() => {
      const id = this.sessionId();
      this.load(id);
    });
  }

  backToList(): void {
    void this.router.navigate(['/dashboard'], { queryParams: { view: 'updates' }, replaceUrl: true });
  }

  private load(id: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.detail.set(null);
    this.bodySafe.set(this.sanitizer.bypassSecurityTrustHtml(''));
    this.updateSessions.getPublished(id).subscribe({
      next: (d) => {
        this.detail.set(d);
        this.bodySafe.set(this.sanitizer.bypassSecurityTrustHtml(d.body ?? ''));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar la actualización.');
        this.loading.set(false);
      },
    });
  }
}
