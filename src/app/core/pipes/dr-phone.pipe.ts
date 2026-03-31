import { Pipe, PipeTransform } from '@angular/core';

import { formatDrPhone } from '../helpers/dr-phone-cedula-format';

@Pipe({
  name: 'drPhone',
  standalone: true,
})
export class DrPhonePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (value == null || String(value).trim() === '') return '';
    return formatDrPhone(String(value));
  }
}
