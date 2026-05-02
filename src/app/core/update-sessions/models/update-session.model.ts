export interface UpdateSessionAuthor {
  id?: number;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

/** Ítem del listado publicado (`GET /api/update-sessions`). */
export interface UpdateSessionListItem {
  id: number;
  title: string;
  published_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_read: boolean;
  [key: string]: unknown;
}

/** Detalle publicado (`GET /api/update-sessions/{id}`) — marca lectura en servidor. */
export interface UpdateSessionDetail extends UpdateSessionListItem {
  body: string;
  author_id?: number;
  author?: UpdateSessionAuthor | null;
  read_at?: string | null;
  [key: string]: unknown;
}

export interface UpdateSessionsUnreadCountResponse {
  unread_count: number;
}

export interface UpdateSessionMarkReadResponse {
  update_session_id: number;
  read_at: string;
}

export interface PaginatedUpdateSessions {
  data: UpdateSessionListItem[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  from?: number | null;
  to?: number | null;
  [key: string]: unknown;
}

/** Fila admin (`GET /api/admin/update-sessions`). */
export interface AdminUpdateSessionRow {
  id: number;
  title: string;
  body?: string;
  published_at: string | null;
  author_id?: number;
  author?: UpdateSessionAuthor | null;
  read_count?: number;
  unread_user_count?: number;
  total_users?: number;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface PaginatedAdminUpdateSessions {
  data: AdminUpdateSessionRow[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  [key: string]: unknown;
}
