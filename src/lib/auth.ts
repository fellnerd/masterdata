import NextAuth from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import type { NextAuthConfig, Session } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { dbQuery, dbExecute } from '@/lib/db-server';
import { recordEntraGroups } from '@/lib/entraGroups';
import { authConfig, type UserRole } from '@/lib/auth.config';

export type { UserRole };

// Extended session user type
interface ExtendedUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  roles: UserRole[];
  groups: string[];
  tenantId?: string;
}

interface ExtendedSession extends Session {
  user: ExtendedUser;
  accessToken?: string;
}

interface ExtendedJWT extends JWT {
  accessToken?: string;
  roles?: UserRole[];
  groups?: string[];
  tenantId?: string;
  groupsOverage?: boolean;
}

// Provisions the user in mds_meta.user on every login (creates the row on
// first login, otherwise stamps last_login_at) and returns their assigned
// roles from mds_meta.user_role. The very first user to ever log in is
// auto-promoted to 'admin' - otherwise nobody could ever assign roles via
// the Users UI (chicken-and-egg bootstrap problem).
async function upsertUserAndGetRoles(params: {
  email: string;
  name?: string | null;
  image?: string | null;
  externalId?: string | null;
}): Promise<UserRole[]> {
  const { email, name, image, externalId } = params;

  const existing = await dbQuery<{ id: number; status: string }>(
    'SELECT id, status FROM mds_meta.[user] WHERE email = @email',
    { email }
  );

  let userId: number;

  if (existing.length > 0) {
    userId = existing[0].id;
    await dbExecute(
      `UPDATE mds_meta.[user]
       SET name = @name,
           image = @image,
           external_id = @externalId,
           last_login_at = GETUTCDATE(),
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END
       WHERE id = @id`,
      { name: name || null, image: image || null, externalId: externalId || null, id: userId }
    );
  } else {
    const countResult = await dbQuery<{ cnt: number }>('SELECT COUNT(*) as cnt FROM mds_meta.[user]');
    const isFirstUser = countResult[0]?.cnt === 0;

    await dbExecute(
      `INSERT INTO mds_meta.[user] (email, name, image, external_id, status, created_by, last_login_at)
       VALUES (@email, @name, @image, @externalId, 'active', 'oauth-signin', GETUTCDATE())`,
      { email, name: name || null, image: image || null, externalId: externalId || null }
    );

    const created = await dbQuery<{ id: number }>('SELECT id FROM mds_meta.[user] WHERE email = @email', { email });
    userId = created[0].id;

    if (isFirstUser) {
      await dbExecute(
        `INSERT INTO mds_meta.user_role (user_id, role, created_by) VALUES (@userId, 'admin', 'system-bootstrap')`,
        { userId }
      );
    }
  }

  const roleRows = await dbQuery<{ role: UserRole }>(
    'SELECT DISTINCT role FROM mds_meta.user_role WHERE user_id = @userId',
    { userId }
  );

  return roleRows.length > 0 ? roleRows.map((r) => r.role) : ['viewer'];
}

// Dev credentials provider for local testing
const devCredentialsProvider = Credentials({
  name: 'Development',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'admin@example.com' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(credentials) {
    // Only allow in development mode
    if (process.env.NODE_ENV !== 'development') {
      return null;
    }

    // Accept any email/password in dev mode
    if (credentials?.email) {
      const email = credentials.email as string;
      return {
        id: '1',
        name: email.includes('admin') ? 'System Admin' : 'Dev User',
        email: email,
      };
    }
    return null;
  },
});

// Build providers based on environment
const providers = [
  // Development credentials
  ...(process.env.NODE_ENV === 'development' ? [devCredentialsProvider] : []),
  // Microsoft Entra ID (production)
  ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID
    ? [
        MicrosoftEntraID({
          clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
          clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
          issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
          authorization: {
            params: {
              // GroupMember.Read.All lets the login token read the display names of the
              // user's groups. It needs tenant-wide admin consent on the app registration
              // first - without it every sign-in would stop at an "approval required" page -
              // so it is only requested when AUTH_ENTRA_GROUP_NAMES=true.
              scope: process.env.AUTH_ENTRA_GROUP_NAMES === 'true'
                ? 'openid profile email User.Read GroupMember.Read.All'
                : 'openid profile email User.Read',
            },
          },
        }),
      ]
    : []),
];

export const fullAuthConfig: NextAuthConfig = {
  ...authConfig,
  providers,

  callbacks: {
    ...authConfig.callbacks,

    async jwt({ token, account, user, profile }): Promise<ExtendedJWT> {
      const extendedToken = token as ExtendedJWT;

      // Initial sign in
      if (account) {
        extendedToken.accessToken = account.access_token;

        // Entra security groups (groupMembershipClaims=SecurityGroup on the app
        // registration) and the tenant the user came from. Object ids only.
        const claims = (profile ?? {}) as { groups?: unknown; tid?: string; _claim_names?: { groups?: string } };
        extendedToken.groups = Array.isArray(claims.groups) ? claims.groups.filter((g): g is string => typeof g === 'string') : [];
        extendedToken.tenantId = claims.tid;
        extendedToken.groupsOverage = !!claims._claim_names?.groups;

        // Provision the user record + load roles. Only runs once, right here
        // at sign-in (this callback executes in the Node.js auth route, not
        // in edge middleware) - the result is cached in the JWT afterwards.
        if (extendedToken.email) {
          try {
            extendedToken.roles = await upsertUserAndGetRoles({
              email: extendedToken.email,
              name: user?.name ?? extendedToken.name,
              image: user?.image ?? extendedToken.picture,
              externalId: account.providerAccountId,
            });
          } catch (error) {
            console.error('Failed to provision user / load roles:', error);
            extendedToken.roles = extendedToken.roles ?? ['viewer'];
          }

          // Remember the groups MDS has seen and this user's membership snapshot
          // (the user row exists now) - best-effort, never blocks the sign-in.
          if (extendedToken.tenantId) {
            try {
              await recordEntraGroups({
                tenantId: extendedToken.tenantId,
                groupIds: extendedToken.groups ?? [],
                accessToken: account.access_token,
                userEmail: extendedToken.email,
              });
            } catch (error) {
              console.error('Failed to record Entra groups:', error);
            }
          }
        }
      }

      // Load roles if still not set (e.g. token refresh without account present)
      if (!extendedToken.roles && extendedToken.email) {
        try {
          extendedToken.roles = await upsertUserAndGetRoles({ email: extendedToken.email });
        } catch (error) {
          console.error('Failed to load roles:', error);
          extendedToken.roles = ['viewer'];
        }
      }

      return extendedToken;
    },

    async session({ session, token }): Promise<ExtendedSession> {
      const extendedToken = token as ExtendedJWT;

      // Pass roles and access token to session
      const extendedSession: ExtendedSession = {
        ...session,
        user: {
          ...session.user,
          id: extendedToken.sub ?? '',
          roles: extendedToken.roles ?? ['viewer'],
          groups: extendedToken.groups ?? [],
          tenantId: extendedToken.tenantId,
        },
        accessToken: extendedToken.accessToken,
      };

      return extendedSession;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(fullAuthConfig);
