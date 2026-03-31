import { Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'rifas-luxury-theme';

export type AppTheme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<AppTheme>('light');

  init(): void {
    if (typeof document === 'undefined') {
      return;
    }
    let stored: AppTheme | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY) as AppTheme | null;
    } catch {
      /* ignore */
    }
    const t = stored === 'dark' ? 'dark' : 'light';
    this.apply(t);
  }

  toggle(): void {
    const next: AppTheme = this.theme() === 'light' ? 'dark' : 'light';
    this.apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  setTheme(t: AppTheme): void {
    this.apply(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }

  private apply(t: AppTheme): void {
    this.theme.set(t);
    if (typeof document === 'undefined') {
      return;
    }
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
}
