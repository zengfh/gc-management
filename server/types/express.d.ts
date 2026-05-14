import type { Role } from '../auth/roles.js';

export interface AuthContext {
  userId: number;
  accountId: number;
  role: Role;
  email: string | null;
  displayName: string | null;
  dek: Buffer;
  blindIndexKey: Buffer;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    auth: AuthContext;
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    accountId?: number;
    role?: Role;
    email?: string | null;
    displayName?: string | null;
    csrfToken?: string;
  }
}
