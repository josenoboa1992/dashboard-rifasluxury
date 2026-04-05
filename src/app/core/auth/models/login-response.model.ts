export interface LoginUser {
  id?: number;
  name?: string;
  role?: string;
  /** Si el API envía bandera explícita de administrador. */
  is_admin?: boolean;
  email?: string;
  cedula?: string;
  phone?: string;
  profile_image_id?: number | null;
  email_verified_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface LoginResponse {
  token?: string;
  access?: string;
  access_token?: string;
  jwt?: string;
  token_type?: string;
  /** Segundos hasta expiración (p. ej. 86400). */
  expires_in?: number;
  /** ISO 8601, p. ej. "2026-04-03T17:00:00+00:00". */
  expires_at?: string;
  user?: LoginUser;
  [key: string]: unknown;
}

