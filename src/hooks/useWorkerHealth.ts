/**
 * useWorkerHealth Hook
 * 
 * Holt regelmäßig den Worker-Status und gibt ihn zurück.
 */

import { useQuery } from '@tanstack/react-query';

export interface WorkerHealthData {
  status: 'healthy' | 'idle' | 'unhealthy' | 'error';
  workers: number;
  isPaused: boolean;
  lastActivity: string | null;
  queuedJobs: number;
  activeJobs: number;
  error?: string;
}

async function fetchWorkerHealth(): Promise<WorkerHealthData> {
  const response = await fetch('/api/jobs/worker-health');
  if (!response.ok) {
    throw new Error('Failed to fetch worker health');
  }
  return response.json();
}

/**
 * Hook zum Abrufen des Worker-Health-Status
 * KEIN automatisches Polling - nur manuelles Refresh
 */
export function useWorkerHealth() {
  return useQuery({
    queryKey: ['worker-health'],
    queryFn: fetchWorkerHealth,
    staleTime: 60 * 1000, // 1 Minute
    refetchInterval: false, // KEIN automatisches Polling
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * Status-Config für UI-Darstellung
 */
export const workerStatusConfig = {
  healthy: { 
    icon: 'pulse' as const, 
    intent: 'success' as const, 
    label: 'Worker aktiv',
    description: 'Worker verarbeitet Jobs'
  },
  idle: { 
    icon: 'time' as const, 
    intent: 'warning' as const, 
    label: 'Worker idle',
    description: 'Worker wartet auf neue Jobs'
  },
  unhealthy: { 
    icon: 'offline' as const, 
    intent: 'danger' as const, 
    label: 'Worker offline',
    description: 'Kein Worker aktiv - Jobs werden nicht verarbeitet'
  },
  error: { 
    icon: 'error' as const, 
    intent: 'danger' as const, 
    label: 'Fehler',
    description: 'Verbindung zum Worker konnte nicht hergestellt werden'
  }
};
