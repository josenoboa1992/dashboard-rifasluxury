import { Directive, ElementRef, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { Subscription } from 'rxjs';

import { formatDrPhone } from '../../helpers/dr-phone-cedula-format';

/** Mantiene el FormControl con solo dígitos; muestra 809-421-0692 o 1-809-421-0692. */
@Directive({
  selector: '[appDrPhoneMask]',
  standalone: true,
})
export class DrPhoneMaskDirective implements OnInit, OnDestroy {
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
    const digits = String(c.value ?? '').replace(/\D/g, '');
    const max = digits.startsWith('1') ? 11 : 10;
    const clipped = digits.slice(0, max);
    if (clipped !== digits) {
      c.setValue(clipped, { emitEvent: false });
    }
    const formatted = formatDrPhone(clipped);
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
    let digits = input.value.replace(/\D/g, '');
    const max = digits.startsWith('1') ? 11 : 10;
    digits = digits.slice(0, max);
    c.setValue(digits, { emitEvent: true });
    const formatted = formatDrPhone(digits);
    if (input.value !== formatted) {
      input.value = formatted;
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}
