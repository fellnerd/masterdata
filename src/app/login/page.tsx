'use client';

import { Button, Card, Callout, Icon, InputGroup, FormGroup, Divider } from '@blueprintjs/core';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

// Check if dev mode - this is set at build time
const isDev = process.env.NEXT_PUBLIC_DEV_MODE === 'true' || process.env.NODE_ENV === 'development';

// Shared container styles to prevent FOUC
const containerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 100,
  overflow: 'auto',
  padding: '40px 20px',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 400,
  padding: 40,
  textAlign: 'center',
  margin: 'auto 0',
};

const headerStyle: React.CSSProperties = {
  marginBottom: 32,
};

const logoStyle: React.CSSProperties = {
  marginBottom: 16,
  color: '#2d72d2',
  minHeight: 48,
  minWidth: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 24,
  fontWeight: 600,
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: '#8f99a8',
};

const footerStyle: React.CSSProperties = {
  marginTop: 24,
  fontSize: 12,
  color: '#8f99a8',
};

const linkStyle: React.CSSProperties = {
  color: '#2d72d2',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('dev');
  const [isLoading, setIsLoading] = useState(false);

  const handleMicrosoftSignIn = () => {
    signIn('microsoft-entra-id', { callbackUrl });
  };

  const handleDevSignIn = async () => {
    setIsLoading(true);
    await signIn('credentials', { email, password, callbackUrl });
    setIsLoading(false);
  };

  return (
    <div style={containerStyle}>
      <Card elevation={3} style={cardStyle}>
        <div style={headerStyle}>
          <div style={logoStyle}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#2d72d2" width={48} height={48}>
              <path d="M2.01 5.1v5.4c0 1.38 3.58 2.5 8 2.5s8-1.12 8-2.5V5.1c-1.49 1.13-4.51 1.9-8 1.9-3.48 0-6.5-.77-8-1.9zm8 .9c4.42 0 8-1.12 8-2.5s-3.58-2.5-8-2.5-8 1.12-8 2.5S5.6 6 10.01 6zm-8 6.1v5.4c0 1.38 3.58 2.5 8 2.5s8-1.12 8-2.5v-5.4c-1.49 1.13-4.51 1.9-8 1.9-3.48 0-6.5-.77-8-1.9z"/>
            </svg>
          </div>
          <h1 style={titleStyle}>Master Data Services</h1>
          <p style={subtitleStyle}>Melden Sie sich mit Ihrem Unternehmenskonto an</p>
        </div>

        {error && (
          <Callout intent="danger" icon="error" style={{ marginBottom: 20 }}>
            {error === 'OAuthAccountNotLinked'
              ? 'Diese E-Mail ist bereits mit einem anderen Konto verknüpft.'
              : error === 'AccessDenied'
              ? 'Der Zugriff wurde verweigert. Bitte kontaktieren Sie Ihren Administrator.'
              : error === 'CredentialsSignin'
              ? 'Ungültige Anmeldedaten.'
              : 'Ein Fehler ist bei der Anmeldung aufgetreten. Bitte versuchen Sie es erneut.'}
          </Callout>
        )}

        <Button
          icon="log-in"
          intent="primary"
          large
          fill
          onClick={handleMicrosoftSignIn}
        >
          Mit Microsoft anmelden
        </Button>

        {isDev && (
          <>
            <Divider style={{ margin: '20px 0' }} />
            <Callout intent="warning" icon="code" style={{ marginBottom: 16 }}>
              <strong>Development Mode</strong>
              <br />
              Verwende einen beliebigen Benutzer für lokale Tests.
            </Callout>
            <FormGroup label="Email" labelFor="dev-email">
              <InputGroup
                id="dev-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </FormGroup>
            <FormGroup label="Password" labelFor="dev-password">
              <InputGroup
                id="dev-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="beliebig"
              />
            </FormGroup>
            <Button
              icon="code"
              intent="warning"
              large
              fill
              onClick={handleDevSignIn}
              loading={isLoading}
            >
              Dev Login
            </Button>
          </>
        )}

        <div style={footerStyle}>
          <p>
            Durch die Anmeldung stimmen Sie den{' '}
            <a href="#" style={linkStyle}>Nutzungsbedingungen</a> und der{' '}
            <a href="#" style={linkStyle}>Datenschutzrichtlinie</a> zu.
          </p>
        </div>
      </Card>
    </div>
  );
}

// Loading fallback uses same styles
function LoginLoading() {
  return (
    <div style={containerStyle}>
      <Card elevation={3} style={cardStyle}>
        <div style={logoStyle}>
          <Icon icon="database" size={48} />
        </div>
        <h1 style={titleStyle}>Master Data Services</h1>
        <p style={subtitleStyle}>Laden...</p>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginContent />
    </Suspense>
  );
}
