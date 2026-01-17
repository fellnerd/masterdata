/**
 * WorkerStatus Component
 * 
 * Zeigt den aktuellen Status des Background-Workers an.
 * Wird im Header der Jobs-Seite angezeigt.
 */

'use client';

import { Spinner, Tag, Tooltip, Icon, Intent } from '@blueprintjs/core';
import { useWorkerHealth, workerStatusConfig, type WorkerHealthData } from '@/hooks/useWorkerHealth';

interface WorkerStatusProps {
  /** Kompakte Darstellung ohne Text */
  minimal?: boolean;
  /** Nur als Icon anzeigen */
  iconOnly?: boolean;
}

/**
 * Worker-Status-Anzeige
 * 
 * Zeigt visuell an ob der Worker aktiv ist, idle oder offline.
 */
export function WorkerStatus({ minimal = false, iconOnly = false }: WorkerStatusProps) {
  const { data: health, isLoading, isError } = useWorkerHealth();
  
  if (isLoading) {
    return <Spinner size={12} />;
  }
  
  // Bestimme Status und Config
  const status = isError ? 'error' : (health?.status || 'error');
  const config = workerStatusConfig[status];
  
  // Tooltip-Inhalt
  const tooltipContent = (
    <div style={{ maxWidth: 200 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{config.label}</div>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{config.description}</div>
      {health && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <div><Icon icon="cog" size={10} /> {health.workers} Worker</div>
          <div><Icon icon="time" size={10} /> {health.queuedJobs} in Queue</div>
          <div><Icon icon="play" size={10} /> {health.activeJobs} aktiv</div>
          {health.lastActivity && (
            <div>
              <Icon icon="history" size={10} /> Letzte Aktivität: {formatLastActivity(health.lastActivity)}
            </div>
          )}
          {health.error && (
            <div style={{ color: 'var(--intent-danger)', marginTop: 4 }}>
              <Icon icon="warning-sign" size={10} /> {health.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
  
  // Icon-Only Modus
  if (iconOnly) {
    return (
      <Tooltip content={tooltipContent}>
        <Icon 
          icon={config.icon} 
          intent={config.intent as Intent}
          style={{ cursor: 'help' }}
        />
      </Tooltip>
    );
  }
  
  // Minimal Modus (nur Tag)
  if (minimal) {
    return (
      <Tooltip content={tooltipContent}>
        <Tag 
          icon={config.icon} 
          intent={config.intent as Intent}
          minimal
          style={{ cursor: 'help' }}
        >
          {config.label}
        </Tag>
      </Tooltip>
    );
  }
  
  // Volle Darstellung
  return (
    <Tooltip content={tooltipContent}>
      <Tag 
        icon={config.icon} 
        intent={config.intent as Intent}
        minimal
        style={{ cursor: 'help' }}
      >
        {config.label}
        {health && health.activeJobs > 0 && (
          <span style={{ marginLeft: 4 }}>({health.activeJobs} aktiv)</span>
        )}
      </Tag>
    </Tooltip>
  );
}

/**
 * Formatiert die letzte Aktivität als relative Zeit
 */
function formatLastActivity(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins < 1) return 'gerade eben';
  if (diffMins < 60) return `vor ${diffMins} Min.`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`;
}

export default WorkerStatus;
