/**
 * useJob Hook
 * 
 * Holt Details eines einzelnen Jobs und bietet Aktionen.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface JobDetails {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: 'active' | 'waiting' | 'completed' | 'failed' | 'delayed' | 'paused';
  progress: number;
  attemptsMade: number;
  attemptsTotal: number;
  createdAt: string;
  processedAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  failedReason: string | null;
  returnValue: unknown;
  logs: string[];
  timeline: Array<{
    event: string;
    timestamp: string;
    details?: string;
  }>;
}

async function fetchJob(id: string): Promise<JobDetails> {
  const response = await fetch(`/api/jobs/${id}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Job nicht gefunden');
    }
    throw new Error('Fehler beim Laden des Jobs');
  }
  return response.json();
}

async function retryJob(id: string): Promise<{ success: boolean; message: string; jobId?: string }> {
  // First try rerun (for completed jobs), which creates a new job
  const response = await fetch(`/api/jobs/${id}?action=rerun`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Fehler beim Wiederholen');
  }
  return response.json();
}

async function cancelJob(id: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`/api/jobs/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Fehler beim Abbrechen');
  }
  return response.json();
}

/**
 * Hook zum Abrufen eines einzelnen Jobs
 */
export function useJob(id: string | null) {
  return useQuery({
    queryKey: ['job', id],
    queryFn: () => fetchJob(id!),
    enabled: !!id,
    staleTime: 30 * 1000, // 30 Sekunden
    refetchInterval: false, // Kein automatisches Polling
  });
}

/**
 * Hook zum Wiederholen eines fehlgeschlagenen Jobs
 */
export function useRetryJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: retryJob,
    onSuccess: (_, id) => {
      // Job und Job-Liste invalidieren
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

/**
 * Hook zum Abbrechen/Entfernen eines Jobs
 */
export function useCancelJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: cancelJob,
    onSuccess: (_, id) => {
      // Job und Job-Liste invalidieren
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}

/**
 * Formatiert die Dauer in lesbares Format
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Formatiert den Job-Status für Anzeige
 */
export function formatJobStatus(status: JobDetails['status']): {
  label: string;
  intent: 'primary' | 'success' | 'danger' | 'warning' | 'none';
  icon: string;
} {
  switch (status) {
    case 'active':
      return { label: 'Läuft', intent: 'primary', icon: 'refresh' };
    case 'waiting':
      return { label: 'Wartend', intent: 'none', icon: 'time' };
    case 'completed':
      return { label: 'Fertig', intent: 'success', icon: 'tick-circle' };
    case 'failed':
      return { label: 'Fehlgeschlagen', intent: 'danger', icon: 'error' };
    case 'delayed':
      return { label: 'Verzögert', intent: 'warning', icon: 'history' };
    case 'paused':
      return { label: 'Pausiert', intent: 'warning', icon: 'pause' };
    default:
      return { label: status, intent: 'none', icon: 'help' };
  }
}

/**
 * Formatiert den Job-Typ für Anzeige
 */
export function formatJobType(type: string): string {
  const typeLabels: Record<string, string> = {
    'dbt-run': 'dbt Run',
    'dbt-test': 'dbt Test',
    'validate': 'Validierung',
    'deploy': 'Data Deploy',
    'schema-deploy': 'Schema Deploy',
    'import': 'Import',
    'export': 'Export',
  };
  return typeLabels[type] || type;
}

async function promoteJob(id: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`/api/jobs/${id}/promote`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Fehler beim Aktivieren');
  }
  return response.json();
}

/**
 * Hook zum Aktivieren (Promoten) eines pausierten/delayed Jobs
 */
export function usePromoteJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: promoteJob,
    onSuccess: (_, id) => {
      // Job und Job-Liste invalidieren
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });
}
