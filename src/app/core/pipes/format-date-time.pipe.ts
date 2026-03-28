import { Pipe, PipeTransform } from '@angular/core';

import { formatDateTimeDisplay } from '../helpers/date-format.helper';

@Pipe({
  name: 'formatDateTime',
  standalone: true,
})
export class FormatDateTimePipe implements PipeTransform {
  transform(value: string | Date | number | null | undefined): string {
    return formatDateTimeDisplay(value);
  }
}
