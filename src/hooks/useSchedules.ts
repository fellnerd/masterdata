/**
 * useSchedules Hook
 * 
 * Hook für Job-Zeitpläne verwalten
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { JobType } from '@/lib/queue/config'

export interface ScheduledJob {
  key: string
  name: string
  id: string | null
  endDate: number | null
  tz: string | null
  pattern: string
  next: number
}

export interface ScheduleOptions {
  name: string
  cron: string
  timezone?: string
  description?: string
}

interface SchedulesResponse {
  schedules: ScheduledJob[]
  count: number
}

interface CreateScheduleParams {
  type: JobType
  target: string
  schedule: ScheduleOptions
  params?: Record<string, unknown>
}

async function fetchSchedules(): Promise<SchedulesResponse> {
  const response = await fetch('/api/schedules')
  if (!response.ok) {
    throw new Error('Fehler beim Laden der Zeitpläne')
  }
  return response.json()
}

async function createSchedule(params: CreateScheduleParams): Promise<{ success: boolean; key: string; message: string }> {
  const response = await fetch('/api/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Fehler beim Erstellen des Zeitplans')
  }
  
  return response.json()
}

async function deleteSchedule(key: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`/api/schedules?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Fehler beim Löschen des Zeitplans')
  }
  
  return response.json()
}

/**
 * Hook zum Abrufen aller Zeitpläne
 */
export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: fetchSchedules,
    staleTime: 30 * 1000, // 30 Sekunden
    refetchInterval: false,
  })
}

/**
 * Hook zum Erstellen eines neuen Zeitplans
 */
export function useCreateSchedule() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: createSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
  })
}

/**
 * Hook zum Löschen eines Zeitplans
 */
export function useDeleteSchedule() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: deleteSchedule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
  })
}

/**
 * Formatiert Cron-Ausdruck in menschenlesbare Form
 */
export function formatCronExpression(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return cron
  
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  
  // Common patterns
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Jede Stunde'
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Täglich um Mitternacht'
  }
  if (minute === '0' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Täglich um ${hour}:00 Uhr`
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '1') {
    return 'Jeden Montag um Mitternacht'
  }
  if (minute === '0' && hour === '0' && dayOfMonth === '1' && month === '*' && dayOfWeek === '*') {
    return 'Am 1. jeden Monats'
  }
  
  // Build description
  let desc = ''
  
  if (minute === '*') {
    desc = 'Jede Minute'
  } else if (minute.includes('/')) {
    desc = `Alle ${minute.split('/')[1]} Minuten`
  } else {
    desc = `Um Minute ${minute}`
  }
  
  if (hour !== '*') {
    if (hour.includes('/')) {
      desc += ` alle ${hour.split('/')[1]} Stunden`
    } else {
      desc += ` um ${hour}:${minute.padStart(2, '0')}`
    }
  }
  
  if (dayOfWeek !== '*' && dayOfWeek !== '?') {
    const days = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
    const dayNames = dayOfWeek.split(',').map(d => days[parseInt(d)] || d).join(', ')
    desc += ` an ${dayNames}`
  }
  
  if (dayOfMonth !== '*') {
    desc += ` am ${dayOfMonth}. Tag`
  }
  
  return desc || cron
}

/**
 * Formatiert den nächsten Ausführungszeitpunkt
 */
export function formatNextRun(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffMs = timestamp - now.getTime()
  
  // Relative Anzeige für nahe Zeitpunkte
  if (diffMs < 60 * 60 * 1000) { // < 1 Stunde
    const mins = Math.round(diffMs / 60000)
    return `In ${mins} Minute${mins !== 1 ? 'n' : ''}`
  }
  if (diffMs < 24 * 60 * 60 * 1000) { // < 24 Stunden
    const hours = Math.round(diffMs / 3600000)
    return `In ${hours} Stunde${hours !== 1 ? 'n' : ''}`
  }
  
  // Absolute Anzeige
  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Vordefinierte Cron-Presets
 */
export const CRON_PRESETS = [
  { label: 'Stündlich', value: '0 * * * *', description: 'Jede volle Stunde' },
  { label: 'Täglich (Mitternacht)', value: '0 0 * * *', description: 'Jeden Tag um 00:00' },
  { label: 'Täglich (6:00)', value: '0 6 * * *', description: 'Jeden Tag um 06:00' },
  { label: 'Täglich (18:00)', value: '0 18 * * *', description: 'Jeden Tag um 18:00' },
  { label: 'Wochentags (8:00)', value: '0 8 * * 1-5', description: 'Mo-Fr um 08:00' },
  { label: 'Wöchentlich (Montag)', value: '0 0 * * 1', description: 'Jeden Montag um 00:00' },
  { label: 'Monatlich', value: '0 0 1 * *', description: 'Am 1. jeden Monats' },
  { label: 'Alle 15 Minuten', value: '*/15 * * * *', description: 'Alle 15 Minuten' },
  { label: 'Alle 30 Minuten', value: '*/30 * * * *', description: 'Alle 30 Minuten' },
] as const
