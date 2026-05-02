import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

import { FormatDateTimePipe } from '../../core/pipes/format-date-time.pipe';
import { SpinnerComponent } from '../../core/ui/spinner/spinner.component';
import type { UpdateSessionListItem } from '../../core/update-sessions/models/update-session.model';
import { UpdateSessionsService } from '../../core/update-sessions/services/update-sessions.service';

@Component({
  selector: 'app-updates',
  standalone: true,
  imports: [FormatDateTimePipe, SpinnerComponent],
  templateUrl: './updates.component.html',
  styleUrl: './updates.component.css',
})
export class UpdatesComponent implements OnInit {
  private readonly updateSessions = inject(UpdateSessionsService);
  private readonly router = inject(Router);

  readonly items = signal<UpdateSessionListItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly currentPage = signal(1);
  readonly lastPage = signal(1);
  readonly total = signal(0);

  ngOnInit(): void {
    this.loadPage(1);
    this.updateSessions.refreshUnreadCount();
  }

  loadPage(page: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.updateSessions
      .listPublished(page, 15)
      .pipe(
        catchError((err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? String((err as { error?: { message?: string } }).error?.message ?? '')
              : '';
          this.error.set(msg.trim() || 'No se pudieron cargar las actualizaciones.');
          return of(null);
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe((res) => {
        if (!res) {
          this.items.set([]);
          return;
        }
        this.items.set(res.data ?? []);
        this.currentPage.set(Math.max(1, Number(res.current_page) || 1));
        this.lastPage.set(Math.max(1, Number(res.last_page) || 1));
        this.total.set(Math.max(0, Number(res.total) || 0));
      });
  }

  goPage(p: number): void {
    const last = this.lastPage();
    const next = Math.min(last, Math.max(1, p));
    this.loadPage(next);
  }

  openDetail(id: number): void {
    void this.router.navigate(['/dashboard'], { queryParams: { view: 'update-detail', updateId: id } });
  }

  onCardKey(ev: KeyboardEvent, id: number): void {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.openDetail(id);
    }
  }
}
