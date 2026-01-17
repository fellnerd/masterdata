'use client';

/**
 * Job Details Page
 * 
 * Zeigt vollständige Details eines einzelnen Jobs an:
 * - Status und Progress
 * - Timeline mit allen Events
 * - Job-Parameter
 * - Vollständige Logs
 * - Aktionen (Retry, Cancel)
 */

import { useParams, useRouter } from 'next/navigation';
import {
  Card,
  Button,
  Tag,
  Spinner,
  NonIdealState,
  ProgressBar,
  Callout,
  Icon,
  Pre,
} from '@blueprintjs/core';
import { Header } from '@/components/layout/Header';
import { 
  useJob, 
  useRetryJob, 
  useCancelJob,
  formatDuration, 
  formatJobStatus, 
  formatJobType 
} from '@/hooks/useJob';
import Link from 'next/link';

export default function JobDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;
  
  const { data: job, isLoading, error, refetch } = useJob(jobId);
  const retryMutation = useRetryJob();
  const cancelMutation = useCancelJob();

  const handleRetry = async () => {
    try {
      await retryMutation.mutateAsync(jobId);
      refetch();
    } catch (err) {
      console.error('Retry failed:', err);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(jobId);
      // Bei erfolgreichem Löschen zurück zur Liste
      if (job?.status !== 'active') {
        router.push('/jobs');
      } else {
        refetch();
      }
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  if (isLoading) {
    return (
      <>
        <Header 
          title="Job Details" 
          breadcrumb={['Operations', 'Jobs', 'Details']}
        />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner size={32} />
        </div>
      </>
    );
  }

  if (error || !job) {
    return (
      <>
        <Header 
          title="Job Details" 
          breadcrumb={['Operations', 'Jobs', 'Details']}
        />
        <NonIdealState
          icon="error"
          title="Job nicht gefunden"
          description={error?.message || 'Der angeforderte Job existiert nicht oder wurde bereits entfernt.'}
          action={
            <Link href="/jobs">
              <Button icon="arrow-left" text="Zurück zur Übersicht" />
            </Link>
          }
        />
      </>
    );
  }

  const statusInfo = formatJobStatus(job.status);

  return (
    <>
      <Header 
        title={`Job ${job.id}`}
        breadcrumb={['Operations', 'Jobs', job.id]}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              icon="refresh"
              text="Aktualisieren"
              onClick={() => refetch()}
              minimal
            />
            {job.status === 'failed' && (
              <Button
                icon="repeat"
                text="Wiederholen"
                intent="primary"
                onClick={handleRetry}
                loading={retryMutation.isPending}
              />
            )}
            {(job.status === 'active' || job.status === 'waiting') && (
              <Button
                icon="cross"
                text="Abbrechen"
                intent="danger"
                onClick={handleCancel}
                loading={cancelMutation.isPending}
              />
            )}
            {(job.status === 'completed' || job.status === 'failed') && (
              <Button
                icon="trash"
                text="Entfernen"
                intent="danger"
                minimal
                onClick={handleCancel}
                loading={cancelMutation.isPending}
              />
            )}
          </div>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status Card */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <Tag 
              large 
              intent={statusInfo.intent} 
              icon={statusInfo.icon as never}
            >
              {statusInfo.label}
            </Tag>
            <span style={{ fontSize: 18, fontWeight: 500 }}>
              {formatJobType(job.name)}
            </span>
            {job.data.target ? (
              <Tag minimal>Target: {String(job.data.target)}</Tag>
            ) : null}
          </div>

          {job.status === 'active' ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Fortschritt</span>
                <span>{job.progress}%</span>
              </div>
              <ProgressBar 
                value={job.progress / 100} 
                intent="primary"
                animate
                stripes
              />
            </div>
          ) : null}

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
            gap: 16 
          }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Erstellt</div>
              <div>{new Date(job.createdAt).toLocaleString('de-DE')}</div>
            </div>
            {job.processedAt ? (
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Gestartet</div>
                <div>{new Date(job.processedAt).toLocaleString('de-DE')}</div>
              </div>
            ) : null}
            {job.finishedAt ? (
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Beendet</div>
                <div>{new Date(job.finishedAt).toLocaleString('de-DE')}</div>
              </div>
            ) : null}
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Dauer</div>
              <div>{formatDuration(job.duration)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Versuche</div>
              <div>{job.attemptsMade} / {job.attemptsTotal}</div>
            </div>
            {job.data.userName ? (
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Benutzer</div>
                <div>{String(job.data.userName)}</div>
              </div>
            ) : null}
          </div>
        </Card>

        {/* Error Callout */}
        {job.status === 'failed' && job.failedReason ? (
          <Callout intent="danger" icon="error" title="Fehlermeldung">
            {job.failedReason}
          </Callout>
        ) : null}

        {/* Timeline Card */}
        <Card>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon="history" />
            Timeline
          </h3>
          <div style={{ position: 'relative', paddingLeft: 24 }}>
            {/* Vertical line */}
            <div style={{
              position: 'absolute',
              left: 7,
              top: 4,
              bottom: 4,
              width: 2,
              backgroundColor: 'var(--divider-color, #e1e8ed)',
            }} />
            
            {job.timeline.map((event, index) => (
              <div 
                key={index}
                style={{ 
                  position: 'relative',
                  paddingBottom: index < job.timeline.length - 1 ? 16 : 0,
                }}
              >
                {/* Dot */}
                <div style={{
                  position: 'absolute',
                  left: -20,
                  top: 4,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: event.event === 'failed' 
                    ? 'var(--intent-danger, #db3737)'
                    : event.event === 'completed'
                    ? 'var(--intent-success, #0f9960)'
                    : 'var(--intent-primary, #137cbd)',
                  border: '2px solid var(--card-background, white)',
                }} />
                
                <div style={{ fontWeight: 500 }}>
                  {event.event === 'created' ? 'Erstellt' : null}
                  {event.event === 'started' ? 'Gestartet' : null}
                  {event.event === 'completed' ? 'Abgeschlossen' : null}
                  {event.event === 'failed' ? 'Fehlgeschlagen' : null}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {new Date(event.timestamp).toLocaleString('de-DE')}
                </div>
                {event.details ? (
                  <div style={{ marginTop: 4, fontSize: 14 }}>
                    {String(event.details)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        {/* Parameters Card */}
        <Card>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon="properties" />
            Parameter
          </h3>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
            gap: 12 
          }}>
            {Object.entries(job.data).map(([key, value]) => {
              // Skip internal fields
              if (['type', 'createdAt'].includes(key)) return null;
              
              const displayValue = typeof value === 'object' && value !== null
                ? JSON.stringify(value, null, 2)
                : String(value ?? '');
              
              return (
                <div key={key} style={{ 
                  padding: 8, 
                  backgroundColor: 'var(--card-background-subtle, #f5f8fa)',
                  borderRadius: 4,
                }}>
                  <div style={{ 
                    color: 'var(--text-muted)', 
                    fontSize: 11, 
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {key}
                  </div>
                  <div style={{ wordBreak: 'break-all' }}>
                    {displayValue}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Logs Card */}
        <Card>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon="console" />
            Logs
            {job.logs.length > 0 ? (
              <Tag minimal round>{job.logs.length} Zeilen</Tag>
            ) : null}
          </h3>
          
          {job.logs.length === 0 ? (
            <NonIdealState
              icon="document"
              title="Keine Logs"
              description={
                job.status === 'waiting' 
                  ? 'Logs werden angezeigt, sobald der Job startet.'
                  : 'Dieser Job hat keine Log-Ausgaben erzeugt.'
              }
            />
          ) : (
            <Pre style={{ 
              maxHeight: 400, 
              overflow: 'auto',
              margin: 0,
              fontSize: 12,
              lineHeight: 1.6,
            }}>
              {job.logs.join('\n')}
            </Pre>
          )}
        </Card>

        {/* Return Value Card (only if present) */}
        {job.returnValue ? (
          <Card>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon icon="code" />
              Rückgabewert
            </h3>
            <Pre style={{ margin: 0 }}>
              {JSON.stringify(job.returnValue, null, 2)}
            </Pre>
          </Card>
        ) : null}
      </div>
    </>
  );
}
