import { LoginResponse } from './login-response.model';

/** Sesión persistida en localStorage / sessionStorage. */
export interface StoredAuthSession {
  token?: string;
  raw?: LoginResponse;
  /** Unix ms cuando expira el token (según API o claim `exp` del JWT). */
  expiresAt?: number;
}
