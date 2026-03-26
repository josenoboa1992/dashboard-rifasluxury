import { Component, input } from '@angular/core';

@Component({
  selector: 'app-spinner',
  standalone: true,
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.css',
})
export class SpinnerComponent {
  readonly size = input<number>(18);
  readonly stroke = input<number>(3);
  readonly label = input<string>('Cargando');
}

