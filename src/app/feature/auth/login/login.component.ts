import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../core/auth/services/auth.service';
import { LoginRequest } from '../../../core/auth/models/login-request.model';
import { SpinnerComponent } from '../../../core/ui/spinner/spinner.component';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.css',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, SpinnerComponent],
})
export class LoginComponent {
  form: FormGroup<{
    email: FormControl<string>;
    password: FormControl<string>;
  }>;

  isSubmitting = false;
  error: string | null = null;
  readonly showPassword = signal(false);

  constructor(
    private readonly fb: FormBuilder,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    // Build the form in the constructor to avoid using `this.fb` before initialization.
    this.form = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(1)]],
    });
  }

  get emailCtrl() {
    return this.form.controls.email;
  }

  get passwordCtrl() {
    return this.form.controls.password;
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  onSubmit(): void {
    if (this.form.invalid || this.isSubmitting) return;
    this.error = null;
    this.isSubmitting = true;

    const payload: LoginRequest = this.form.getRawValue();

    this.auth
      .login(payload)
      .pipe(
        finalize(() => {
          this.isSubmitting = false;
        }),
      )
      .subscribe({
        next: (res) => {
          this.auth.saveAuth(res);
          const token = this.auth.getToken();
          if (!token) {
            this.auth.clearSession();
            this.error =
              'No se pudo guardar la sesión porque el backend no devolvió un token (o el formato es distinto).';
            return;
          }

          this.router.navigateByUrl('/dashboard');
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible iniciar sesión. Verifica tus credenciales.';
          this.error = String(message);
        },
      });
  }
}

