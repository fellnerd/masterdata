'use client'

import { 
  Card, 
  HTMLTable, 
  Tag, 
  Button, 
  NonIdealState,
  Spinner,
  Callout,
} from '@blueprintjs/core'
import { 
  useSchedules, 
  useDeleteSchedule, 
  formatCronExpression, 
  formatNextRun,
  ScheduledJob 
} from '@/hooks/useSchedules'

interface SchedulesListProps {
  onCreateNew?: () => void
}

export function SchedulesList({ onCreateNew }: SchedulesListProps) {
  const { data, isLoading, error, refetch } = useSchedules()
  const deleteScheduleMutation = useDeleteSchedule()
  
  const handleDelete = async (schedule: ScheduledJob) => {
    if (!confirm(`Zeitplan "${schedule.name}" wirklich löschen?`)) return
    
    try {
      await deleteScheduleMutation.mutateAsync(schedule.key)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler beim Löschen')
    }
  }
  
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spinner size={32} />
      </div>
    )
  }
  
  if (error) {
    return (
      <Callout intent="danger" icon="error">
        Fehler beim Laden der Zeitpläne: {error.message}
        <Button small minimal icon="refresh" onClick={() => refetch()} style={{ marginLeft: 8 }}>
          Erneut versuchen
        </Button>
      </Callout>
    )
  }
  
  const schedules = data?.schedules || []
  
  if (schedules.length === 0) {
    return (
      <NonIdealState
        icon="time"
        title="Keine Zeitpläne"
        description="Es sind keine geplanten Jobs konfiguriert. Erstellen Sie einen neuen Zeitplan, um Jobs automatisch auszuführen."
        action={
          onCreateNew ? (
            <Button icon="add" intent="primary" onClick={onCreateNew}>
              Neuen Zeitplan erstellen
            </Button>
          ) : undefined
        }
      />
    )
  }
  
  return (
    <Card style={{ padding: 0 }}>
      <HTMLTable striped style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Zeitplan</th>
            <th>Nächste Ausführung</th>
            <th>Zeitzone</th>
            <th style={{ width: 100 }}>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map(schedule => (
            <tr key={schedule.key}>
              <td>
                <strong>{schedule.name}</strong>
                <div style={{ fontSize: 11, color: 'var(--gray3)' }}>
                  ID: {schedule.id || schedule.key.slice(0, 20)}...
                </div>
              </td>
              <td>
                <Tag minimal>{schedule.pattern}</Tag>
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  {formatCronExpression(schedule.pattern)}
                </div>
              </td>
              <td>
                <Tag intent="primary" minimal>
                  {formatNextRun(schedule.next)}
                </Tag>
              </td>
              <td>
                <Tag minimal>{schedule.tz || 'UTC'}</Tag>
              </td>
              <td>
                <Button
                  small
                  minimal
                  icon="trash"
                  intent="danger"
                  loading={deleteScheduleMutation.isPending}
                  onClick={() => handleDelete(schedule)}
                  title="Zeitplan löschen"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>
    </Card>
  )
}
