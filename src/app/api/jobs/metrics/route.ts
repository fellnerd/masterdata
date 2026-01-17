/**
 * Job Metrics API Route
 * 
 * GET /api/jobs/metrics - Holt Job-Metriken für einen Zeitraum
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getMdsQueue } from '@/lib/queue/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface JobMetricsResponse {
  totalCompleted: number;
  totalFailed: number;
  successRate: number;
  avgDurationByType: Record<string, number>;
  dailyStats: Array<{
    date: string;
    completed: number;
    failed: number;
  }>;
  period: number; // Anzahl der Tage
}

/**
 * Gruppiert Array nach einem Key
 */
function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

/**
 * GET /api/jobs/metrics?days=7
 * Holt Metriken für die letzten N Tage
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7');
    
    const queue = getMdsQueue();
    
    try {
      // Jobs aus Queue holen
      const [completed, failed] = await Promise.all([
        queue.getCompleted(0, 1000),
        queue.getFailed(0, 1000)
      ]);
      
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      
      // Jobs im Zeitraum filtern
      const recentCompleted = completed.filter(j => j.finishedOn && j.finishedOn > cutoff);
      const recentFailed = failed.filter(j => j.finishedOn && j.finishedOn > cutoff);
      
      // Erfolgsrate berechnen
      const total = recentCompleted.length + recentFailed.length;
      const successRate = total > 0 ? Math.round((recentCompleted.length / total) * 100) : 100;
      
      // Durchschnittliche Dauer pro Typ berechnen
      const byType = groupBy(recentCompleted, j => j.name);
      const avgDurationByType: Record<string, number> = {};
      
      for (const [type, jobs] of Object.entries(byType)) {
        const validJobs = jobs.filter(j => j.finishedOn && j.processedOn);
        if (validJobs.length > 0) {
          const totalDuration = validJobs.reduce(
            (sum, j) => sum + (j.finishedOn! - j.processedOn!), 
            0
          );
          avgDurationByType[type] = Math.round(totalDuration / validJobs.length / 1000); // in Sekunden
        }
      }
      
      // Tägliche Statistiken
      const dailyStats: JobMetricsResponse['dailyStats'] = [];
      
      for (let i = days - 1; i >= 0; i--) {
        const dayStart = new Date();
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayEnd.getDate() + 1);
        
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayEnd.getTime();
        
        const dayCompleted = recentCompleted.filter(
          j => j.finishedOn && j.finishedOn >= dayStartMs && j.finishedOn < dayEndMs
        ).length;
        
        const dayFailed = recentFailed.filter(
          j => j.finishedOn && j.finishedOn >= dayStartMs && j.finishedOn < dayEndMs
        ).length;
        
        dailyStats.push({
          date: dayStart.toISOString().split('T')[0],
          completed: dayCompleted,
          failed: dayFailed
        });
      }
      
      const response: JobMetricsResponse = {
        totalCompleted: recentCompleted.length,
        totalFailed: recentFailed.length,
        successRate,
        avgDurationByType,
        dailyStats,
        period: days
      };
      
      return NextResponse.json(response);
    } catch (queueError) {
      console.error('Queue error in metrics:', queueError);
      
      // Return empty metrics on queue error
      const response: JobMetricsResponse = {
        totalCompleted: 0,
        totalFailed: 0,
        successRate: 100,
        avgDurationByType: {},
        dailyStats: [],
        period: days
      };
      
      return NextResponse.json(response);
    }
  } catch (error) {
    console.error('Failed to get job metrics:', error);
    
    // Return empty state on any error (incl. rate limit)
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '7');
    
    const response: JobMetricsResponse = {
      totalCompleted: 0,
      totalFailed: 0,
      successRate: 100,
      avgDurationByType: {},
      dailyStats: [],
      period: days
    };
    
    return NextResponse.json(response);
  }
}
