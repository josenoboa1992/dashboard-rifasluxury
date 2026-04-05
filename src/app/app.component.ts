import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './core/auth/services/auth.service';
import { ThemeService } from './core/ui/theme/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class AppComponent {
  title = 'dashboard-rifasluxury';

  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.theme.init();
      this.auth.initSessionExpiryHandling();
    }
  }
}
