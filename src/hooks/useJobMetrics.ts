/**
 * useJobMetrics Hook
 * 
 * Holt Job-Metriken für einen bestimmten Zeitraum.
 */

import { useQuery } from '@tanstack/react-query';

export interface JobMetrics {
  totalCompleted: number;
  totalFailed: number;
  successRate: number;
  avgDurationByType: Record<string, number>;
  dailyStats: Array<{
    date: string;
    completed: number;
    failed: number;
  }>;
  period: number;
}

async function fetchJobMetrics(days: number): Promise<JobMetrics> {
  const response = await fetch(`/api/jobs/metrics?days=${days}`);
  if (!response.ok) {
    throw new Error('Failed to fetch job metrics');
  }
  return response.json();
}

/**
 * Hook zum Abrufen von Job-Metriken
 * 
 * @param days - Anzahl der Tage für die Metriken (Standard: 7)
 */
export function useJobMetrics(days: number = 7) {
  return useQuery({
    queryKey: ['job-metrics', days],
    queryFn: () => fetchJobMetrics(days),
    staleTime: 5 * 60 * 1000, // 5 Minuten
    refetchInterval: false, // KEIN automatisches Polling
    retry: 1
  });
}
