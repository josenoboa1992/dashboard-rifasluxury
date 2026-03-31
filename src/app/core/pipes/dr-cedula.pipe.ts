import { Pipe, PipeTransform } from '@angular/core';

import { formatDrCedula } from '../helpers/dr-phone-cedula-format';

@Pipe({
  name: 'drCedula',
  standalone: true,
})
export class DrCedulaPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (value == null || String(value).trim() === '') return '';
    return formatDrCedula(String(value));
  }
}
