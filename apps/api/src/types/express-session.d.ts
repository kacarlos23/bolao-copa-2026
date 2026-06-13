import type { UserRole } from '@bolao/shared';

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      username: string;
      nickname: string;
      avatarUrl?: string | null;
      role: UserRole;
    };
  }
}
