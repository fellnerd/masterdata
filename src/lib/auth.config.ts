import type { NextAuthConfig, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

// Edge-safe auth config: NO database imports here. This is bundled into the
// Edge middleware (middleware.ts), which cannot load Node-only drivers like
// mssql/tedious (they use node:stream etc., unsupported on Edge). The
// providers and the DB-touching jwt() callback live in auth.ts instead
// (Node.js-runtime route handlers only).
//
// The session() callback below IS included here (not just in auth.ts): it
// only reads fields already baked into the signed JWT (no I/O), and
// middleware's own auth() instance needs it too - otherwise auth.user.roles
// would be empty in middleware even though the token has real roles, since
// each NextAuth() instance only runs the callbacks defined in ITS OWN config.

export type UserRole = 'viewer' | 'editor' | 'approver' | 'admin';

interface ExtendedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  roles: UserRole[];
}

interface ExtendedSession extends Session {
  user: ExtendedUser;
}

interface ExtendedJWT extends JWT {
  roles?: UserRole[];
}

export const authConfig: NextAuthConfig = {
  providers: [],

  callbacks: {
    async session({ session, token }): Promise<ExtendedSession> {
      const extendedToken = token as ExtendedJWT;
      return {
        ...session,
        user: {
          ...session.user,
          id: extendedToken.sub ?? '',
          roles: extendedToken.roles ?? ['viewer'],
        },
      };
    },

    async authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { pathname } = request.nextUrl;

      // Public routes. Note: /api/v1 is "public" only in the sense that NextAuth's
      // session cookie isn't required here - each /api/v1 route enforces its own
      // Bearer API-token check internally (see src/lib/apiToken.ts). The
      // internal /api/models, /api/entities, /api/attributes, /api/records and
      // /api/commits routes have no auth check of their own, so they must NOT
      // be listed here - they need the session gate below like every other
      // internal route, matching the pages that call them.
      // /api-docs is the interactive API reference for /api/v1 - deliberately
      // not gated by MSAL/session login either, since it authenticates
      // "Try it out" calls via a pasted API token inside the page itself
      // (Scalar's own Authorize dialog), not via the app's session.
      const publicRoutes = ['/login', '/api/auth', '/api/health', '/api/v1', '/api-docs'];
      if (publicRoutes.some(route => pathname.startsWith(route))) {
        return true;
      }

      // Protected routes require authentication
      if (!isLoggedIn) {
        return false;
      }

      // Admin-only routes
      const adminRoutes = ['/settings/users'];
      if (adminRoutes.some(route => pathname.startsWith(route))) {
        const roles = (auth?.user as ExtendedUser | undefined)?.roles ?? [];
        if (!roles.includes('admin')) {
          return false;
        }
      }

      return true;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },

  trustHost: true,
};
