export interface LoginResponse {
  token?: string;
  access?: string;
  access_token?: string;
  jwt?: string;
  user?: unknown;
  [key: string]: unknown;
}

