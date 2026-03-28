import { Pipe, PipeTransform } from '@angular/core';

import { formatMoneyDop } from '../helpers/money-format.helper';

@Pipe({
  name: 'formatMoney',
  standalone: true,
})
export class FormatMoneyPipe implements PipeTransform {
  transform(value: string | number | null | undefined): string {
    return formatMoneyDop(value);
  }
}
