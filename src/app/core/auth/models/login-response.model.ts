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
  user?: LoginUser;
  [key: string]: unknown;
}

