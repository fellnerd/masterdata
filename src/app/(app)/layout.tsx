'use client';

import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Button, NonIdealState, Spinner, Tag } from '@blueprintjs/core';
import { Sidebar } from "@/components/layout/Sidebar";
import { AccessProvider, useAccess } from '@/components/providers/AccessProvider';

// Pages only a global admin may open (the APIs behind them enforce the same).
const SYSTEM_ONLY = ['/settings/users', '/settings/permissions', '/settings/config', '/jobs'];

function AccessGate({ children }: { children: React.ReactNode }) {
  const access = useAccess();
  const pathname = usePathname();

  if (access.loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spinner />
      </div>
    );
  }

  // The check itself failed: say so instead of claiming the user has no permission.
  if (access.failed) {
    return (
      <div style={{ marginTop: 80 }}>
        <NonIdealState
          icon="warning-sign"
          title={access.failed === 'unauthorized' ? 'Sitzung ungültig' : 'Berechtigungen konnten nicht geprüft werden'}
          description={
            access.failed === 'unauthorized'
              ? 'Deine Anmeldung ist nicht mehr gültig. Bitte melde dich ab und neu an.'
              : 'Der Server hat die Prüfung gerade nicht beantwortet. Das ist kein Zeichen für fehlende Rechte - bitte neu laden.'
          }
          action={
            <>
              <Button icon="refresh" onClick={() => window.location.reload()} style={{ marginRight: 8 }}>Neu laden</Button>
              <Button icon="log-out" onClick={() => signOut({ callbackUrl: '/login' })}>Abmelden</Button>
            </>
          }
        />
      </div>
    );
  }

  // Signed in with Microsoft, but no permission anywhere: nothing to show.
  if (!access.hasAccess) {
    return (
      <div style={{ marginTop: 80 }}>
      <NonIdealState
        icon="lock"
        title="Kein Zugriff"
        description={
          <>
            <p>
              {access.email ? <>Das Konto <strong>{access.email}</strong> hat</> : 'Dieses Konto hat'} noch
              keine Berechtigung in Master Data Services.
            </p>
            <p>
              Der Zugriff wird über Entra-Sicherheitsgruppen vergeben. Bitte einen Administrator, dich in die
              passende Gruppe (z. B. <code>sg-mds-…</code>) aufzunehmen, und melde dich danach neu an.
            </p>
            <p className="text-muted" style={{ fontSize: 12 }}>
              Diese Anmeldung enthält {access.tokenGroups ?? 0} Entra-Gruppe(n)
              {(access.tokenGroups ?? 0) === 0 ? ' - falls du gerade in eine Gruppe aufgenommen wurdest, melde dich ab und wieder an.' : '.'}
            </p>
          </>
        }
        action={<Button icon="log-out" onClick={() => signOut({ callbackUrl: '/login' })}>Abmelden</Button>}
      />
    </div>
    );
  }

  if (SYSTEM_ONLY.some(p => pathname.startsWith(p)) && !access.capabilities.system) {
    return (
      <div style={{ marginTop: 80 }}>
      <NonIdealState
        icon="shield"
        title="Nur für Administratoren"
        description={<>Diese Seite ist Administratoren vorbehalten. <Tag minimal>{access.email}</Tag></>}
      />
      </div>
    );
  }

  return <>{children}</>;
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AccessProvider>
      <div className="app-container">
        <Sidebar />
        <main className="main-content">
          <AccessGate>{children}</AccessGate>
        </main>
      </div>
    </AccessProvider>
  )
}
