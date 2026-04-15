import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../auth/services/auth.service';

export interface OrdersDistributionChartResponse {
  total_orders: number;
  pending: number;
  confirmed: number;
  cancelled: number;
  /** Cupo disponible total (suma pool restante de todas las rifas). */
  available: number;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class ChartsService {
  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
  ) {}

  private authHeaders(): HttpHeaders {
    const token = this.auth.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  ordersDistribution(): Observable<OrdersDistributionChartResponse> {
    return this.http.get<OrdersDistributionChartResponse>(
      `${environment.apiBaseUrl}/api/admin/charts/orders-distribution`,
      { headers: this.authHeaders() },
    );
  }
}

