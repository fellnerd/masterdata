/**
 * JobMetrics Component
 * 
 * Zeigt Job-Metriken und Statistiken als Dashboard an.
 */

'use client';

import { useState } from 'react';
import {
  Card,
  Tag,
  Tooltip,
  Button,
  ButtonGroup,
  Spinner,
  Icon,
  Collapse
} from '@blueprintjs/core';
import { useJobMetrics, type JobMetrics } from '@/hooks/useJobMetrics';

interface JobMetricsProps {
  /** Initial eingeklappt */
  initialCollapsed?: boolean;
}

/**
 * Formatiert Sekunden als lesbare Dauer
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Bestimmt die Farbe basierend auf der Erfolgsrate
 */
function getSuccessRateColor(rate: number): string {
  if (rate >= 95) return 'var(--intent-success, #0f9960)';
  if (rate >= 80) return 'var(--intent-warning, #d9822b)';
  return 'var(--intent-danger, #db3737)';
}

/**
 * JobMetrics Dashboard Komponente
 */
export function JobMetricsCard({ initialCollapsed = true }: JobMetricsProps) {
  const [days, setDays] = useState(7);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const { data: metrics, isLoading, isError, refetch } = useJobMetrics(days);
  
  if (isError) {
    return null; // Bei Fehler ausblenden
  }
  
  // Berechne maximalen Wert für Balkendiagramm
  const maxDailyJobs = metrics?.dailyStats 
    ? Math.max(...metrics.dailyStats.map(d => d.completed + d.failed), 1) 
    : 1;
  
  return (
    <Card style={{ marginBottom: 16, padding: 0 }}>
      {/* Header */}
      <div 
        style={{ 
          padding: '12px 16px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color, #e1e8ed)'
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon icon={isCollapsed ? 'chevron-right' : 'chevron-down'} />
          <Icon icon="chart" />
          <strong>Job-Metriken ({days} Tage)</strong>
          {isLoading && <Spinner size={14} />}
        </div>
        
        {/* Quick Stats im Header (auch wenn eingeklappt) */}
        {metrics && !isCollapsed && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Tag minimal intent="success">{metrics.totalCompleted} OK</Tag>
            {metrics.totalFailed > 0 && (
              <Tag minimal intent="danger">{metrics.totalFailed} Fehler</Tag>
            )}
            <span style={{ color: getSuccessRateColor(metrics.successRate), fontWeight: 600 }}>
              {metrics.successRate}%
            </span>
          </div>
        )}
        
        {!isCollapsed && (
          <div onClick={e => e.stopPropagation()}>
            <ButtonGroup>
              <Button small active={days === 7} onClick={() => setDays(7)}>7T</Button>
              <Button small active={days === 14} onClick={() => setDays(14)}>14T</Button>
              <Button small active={days === 30} onClick={() => setDays(30)}>30T</Button>
            </ButtonGroup>
          </div>
        )}
      </div>
      
      <Collapse isOpen={!isCollapsed}>
        <div style={{ padding: 16 }}>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <div className="kpi-card">
              <span className="kpi-label">Erfolgsrate</span>
              <span className="kpi-value" style={{ color: getSuccessRateColor(metrics?.successRate ?? 100) }}>
                {metrics?.successRate ?? '-'}%
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Abgeschlossen</span>
              <span className="kpi-value" style={{ color: 'var(--intent-success)' }}>
                {metrics?.totalCompleted ?? 0}
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Fehlgeschlagen</span>
              <span className="kpi-value" style={{ color: metrics?.totalFailed ? 'var(--intent-danger)' : undefined }}>
                {metrics?.totalFailed ?? 0}
              </span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">Gesamt</span>
              <span className="kpi-value">
                {(metrics?.totalCompleted ?? 0) + (metrics?.totalFailed ?? 0)}
              </span>
            </div>
          </div>
          
          {/* Tages-Chart */}
          {metrics?.dailyStats && metrics.dailyStats.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>
                <Icon icon="timeline-bar-chart" size={12} /> Tägliche Übersicht
              </div>
              <div style={{ display: 'flex', gap: 4, height: 80, alignItems: 'flex-end' }}>
                {metrics.dailyStats.map(day => {
                  const total = day.completed + day.failed;
                  const completedHeight = total > 0 ? (day.completed / maxDailyJobs) * 60 : 0;
                  const failedHeight = total > 0 ? (day.failed / maxDailyJobs) * 60 : 0;
                  
                  return (
                    <Tooltip 
                      key={day.date} 
                      content={
                        <div>
                          <div>{new Date(day.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
                          <div>✓ {day.completed} OK</div>
                          {day.failed > 0 && <div>✗ {day.failed} Fehler</div>}
                        </div>
                      }
                    >
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 12 }}>
                        {failedHeight > 0 && (
                          <div style={{ 
                            background: 'var(--intent-danger, #db3737)', 
                            height: failedHeight,
                            borderRadius: 2,
                            minHeight: 2
                          }} />
                        )}
                        {completedHeight > 0 && (
                          <div style={{ 
                            background: 'var(--intent-success, #0f9960)', 
                            height: completedHeight,
                            borderRadius: 2,
                            minHeight: 2
                          }} />
                        )}
                        {total === 0 && (
                          <div style={{
                            background: 'var(--border-color, #e1e8ed)',
                            height: 4,
                            borderRadius: 2
                          }} />
                        )}
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span className="text-muted" style={{ fontSize: 10 }}>
                  {metrics.dailyStats[0]?.date ? new Date(metrics.dailyStats[0].date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''}
                </span>
                <span className="text-muted" style={{ fontSize: 10 }}>
                  {metrics.dailyStats[metrics.dailyStats.length - 1]?.date ? new Date(metrics.dailyStats[metrics.dailyStats.length - 1].date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : ''}
                </span>
              </div>
            </div>
          )}
          
          {/* Durchschnittliche Dauer pro Typ */}
          {metrics?.avgDurationByType && Object.keys(metrics.avgDurationByType).length > 0 && (
            <div>
              <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>
                <Icon icon="time" size={12} /> Ø Laufzeit pro Typ
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(metrics.avgDurationByType).map(([type, seconds]) => (
                  <Tag key={type} minimal>
                    {type}: {formatDuration(seconds)}
                  </Tag>
                ))}
              </div>
            </div>
          )}
          
          {/* Leerer State */}
          {metrics && metrics.totalCompleted === 0 && metrics.totalFailed === 0 && (
            <div className="text-muted" style={{ textAlign: 'center', padding: 16 }}>
              <Icon icon="info-sign" size={16} style={{ marginRight: 8 }} />
              Keine Jobs im gewählten Zeitraum
            </div>
          )}
        </div>
      </Collapse>
    </Card>
  );
}

export default JobMetricsCard;
