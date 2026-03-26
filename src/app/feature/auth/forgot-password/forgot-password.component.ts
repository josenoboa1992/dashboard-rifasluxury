import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { finalize } from 'rxjs';

import {
  AuthService,
  ResetPasswordRequest,
} from '../../../core/auth/services/auth.service';
import { SpinnerComponent } from '../../../core/ui/spinner/spinner.component';

type Step = 'request' | 'reset';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, SpinnerComponent],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.css',
})
export class ForgotPasswordComponent {
  readonly step = signal<Step>('request');
  readonly isSubmitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);

  requestForm: FormGroup<{
    email: FormControl<string>;
  }>;

  resetForm: FormGroup<{
    email: FormControl<string>;
    otp: FormControl<string>;
    password: FormControl<string>;
    password_confirmation: FormControl<string>;
  }>;

  readonly showPassword = signal(false);
  readonly showPasswordConfirmation = signal(false);

  readonly canGoReset = computed(() => this.step() === 'reset');

  constructor(
    private readonly fb: FormBuilder,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    this.requestForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
    });

    this.resetForm = this.fb.nonNullable.group({
      email: ['', [Validators.required, Validators.email]],
      otp: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      password_confirmation: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  get reqEmailCtrl() {
    return this.requestForm.controls.email;
  }

  get resetEmailCtrl() {
    return this.resetForm.controls.email;
  }

  get otpCtrl() {
    return this.resetForm.controls.otp;
  }

  get passwordCtrl() {
    return this.resetForm.controls.password;
  }

  get passwordConfirmationCtrl() {
    return this.resetForm.controls.password_confirmation;
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  togglePasswordConfirmation(): void {
    this.showPasswordConfirmation.update((v) => !v);
  }

  goBackToLogin(): void {
    this.router.navigateByUrl('/login');
  }

  goToRequest(): void {
    this.error.set(null);
    this.info.set(null);
    this.step.set('request');
  }

  goToReset(email?: string): void {
    this.error.set(null);
    this.info.set(null);
    this.step.set('reset');
    if (email) {
      this.resetForm.patchValue({ email });
    }
  }

  onRequestOtp(): void {
    if (this.requestForm.invalid || this.isSubmitting()) return;
    this.error.set(null);
    this.info.set(null);
    this.isSubmitting.set(true);

    const { email } = this.requestForm.getRawValue();

    this.auth
      .forgotPassword({ email })
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: (res) => {
          this.info.set(
            String(
              res?.message ||
                'Si el correo existe, se enviará un código de recuperación.',
            ),
          );
          this.goToReset(email);
        },
        error: (err) => {
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            'No fue posible enviar el código. Intenta de nuevo.';
          this.error.set(String(message));
        },
      });
  }

  onResetPassword(): void {
    if (this.resetForm.invalid || this.isSubmitting()) return;

    const value = this.resetForm.getRawValue();
    if (value.password !== value.password_confirmation) {
      this.error.set('Las contraseñas no coinciden.');
      return;
    }

    this.error.set(null);
    this.info.set(null);
    this.isSubmitting.set(true);

    const payload: ResetPasswordRequest = value;

    this.auth
      .resetPassword(payload)
      .pipe(finalize(() => this.isSubmitting.set(false)))
      .subscribe({
        next: () => {
          // Auto login with the new password
          this.isSubmitting.set(true);
          this.auth
            .login({ email: value.email, password: value.password })
            .pipe(finalize(() => this.isSubmitting.set(false)))
            .subscribe({
              next: (res) => {
                this.auth.saveAuth(res);
                const token = this.auth.getToken();
                if (!token) {
                  this.auth.clearSession();
                  this.error.set(
                    'La contraseña fue actualizada, pero no se pudo iniciar sesión automáticamente (token no encontrado).',
                  );
                  this.router.navigateByUrl('/login');
                  return;
                }
                this.router.navigateByUrl('/dashboard');
              },
              error: () => {
                this.info.set(
                  'Contraseña actualizada. Ahora inicia sesión con tu nueva contraseña.',
                );
                this.router.navigateByUrl('/login');
              },
            });
        },
        error: (err) => {
          // 422: OTP inválido/expirado o validación
          const message =
            err?.error?.message ||
            err?.error?.detail ||
            (err?.status === 422
              ? 'OTP inválido o expirado. Verifica el código e inténtalo de nuevo.'
              : 'No fue posible restablecer la contraseña. Intenta de nuevo.');
          this.error.set(String(message));
        },
      });
  }
}

