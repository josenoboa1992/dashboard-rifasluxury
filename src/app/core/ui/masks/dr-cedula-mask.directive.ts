import { Directive, ElementRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { Subscription } from 'rxjs';

import { formatDrCedula } from '../../helpers/dr-phone-cedula-format';

/** FormControl solo dígitos (máx. 11); muestra 402-2238237-2. */
@Directive({
  selector: '[appDrCedulaMask]',
  standalone: true,
})
export class DrCedulaMaskDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLInputElement>);
  private readonly ngControl = inject(NgControl);

  private sub?: Subscription;

  ngOnInit(): void {
    const c = this.ngControl.control;
    if (!c) return;
    this.sub = c.valueChanges.subscribe(() => this.syncDisplay());
    queueMicrotask(() => this.syncDisplay());
  }

  private syncDisplay(): void {
    const c = this.ngControl.control;
    if (!c) return;
    const digits = String(c.value ?? '').replace(/\D/g, '').slice(0, 11);
    const cur = String(c.value ?? '').replace(/\D/g, '');
    if (digits !== cur) {
      c.setValue(digits, { emitEvent: false });
    }
    const formatted = formatDrCedula(digits);
    const input = this.el.nativeElement;
    if (input.value !== formatted) {
      input.value = formatted;
    }
  }

  @HostListener('input')
  onInput(): void {
    const c = this.ngControl.control;
    if (!c) return;
    const input = this.el.nativeElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 11);
    c.setValue(digits, { emitEvent: true });
    const formatted = formatDrCedula(digits);
    if (input.value !== formatted) {
      input.value = formatted;
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
