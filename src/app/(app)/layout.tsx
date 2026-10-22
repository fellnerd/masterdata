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
