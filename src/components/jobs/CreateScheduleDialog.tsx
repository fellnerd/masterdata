'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  Button,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Callout,
  Tag,
} from '@blueprintjs/core'
import { JobType } from '@/lib/queue/config'
import { useCreateSchedule, CRON_PRESETS, formatCronExpression } from '@/hooks/useSchedules'

interface CreateScheduleDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const JOB_TYPES: Array<{ value: JobType; label: string; description: string }> = [
  { value: 'dbt-run', label: 'dbt Run', description: 'dbt Models ausführen' },
  { value: 'dbt-test', label: 'dbt Test', description: 'dbt Tests ausführen' },
  { value: 'validate', label: 'Validierung', description: 'Datenvalidierung durchführen' },
  { value: 'deploy', label: 'Data Deploy', description: 'Daten in Data Vault deployen' },
  { value: 'schema-deploy', label: 'Schema Deploy', description: 'Schema-Änderungen deployen' },
]

export function CreateScheduleDialog({ isOpen, onClose, onSuccess }: CreateScheduleDialogProps) {
  const createScheduleMutation = useCreateSchedule()
  
  // Form state
  const [name, setName] = useState('')
  const [jobType, setJobType] = useState<JobType>('dbt-run')
  const [target, setTarget] = useState('')
  const [cronPreset, setCronPreset] = useState<string>(CRON_PRESETS[1].value) // Daily midnight
  const [customCron, setCustomCron] = useState('')
  const [useCustomCron, setUseCustomCron] = useState(false)
  const [timezone, setTimezone] = useState('Europe/Berlin')
  
  const effectiveCron = useCustomCron ? customCron : cronPreset
  
  const handleSubmit = async () => {
    try {
      await createScheduleMutation.mutateAsync({
        type: jobType,
        target,
        schedule: {
          name,
          cron: effectiveCron,
          timezone,
        },
      })
      
      // Reset form
      setName('')
      setTarget('')
      setCronPreset(CRON_PRESETS[1].value)
      setCustomCron('')
      setUseCustomCron(false)
      
      onSuccess?.()
      onClose()
    } catch {
      // Error is handled by mutation state
    }
  }
  
  const isValid = name.trim() && target.trim() && effectiveCron.trim()

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Neuen Zeitplan erstellen"
      icon="time"
      style={{ width: 500 }}
    >
      <DialogBody>
        <FormGroup label="Name" labelInfo="(erforderlich)">
          <InputGroup
            placeholder="z.B. Täglicher dbt Run"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormGroup>
        
        <FormGroup label="Job-Typ" labelInfo="(erforderlich)">
          <HTMLSelect
            value={jobType}
            onChange={(e) => setJobType(e.target.value as JobType)}
            fill
          >
            {JOB_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label} - {type.description}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>
        
        <FormGroup 
          label="Target" 
          labelInfo="(erforderlich)"
          helperText={
            jobType === 'dbt-run' || jobType === 'dbt-test' 
              ? 'dbt Selector, z.B. "hub_customer sat_customer" oder "*"'
              : jobType === 'deploy' || jobType === 'schema-deploy'
              ? 'Entity-Code(s), z.B. "customer" oder "all"'
              : 'Target-Beschreibung'
          }
        >
          <InputGroup
            placeholder={
              jobType === 'dbt-run' ? 'hub_* sat_*' : 
              jobType === 'dbt-test' ? '*' :
              'all'
            }
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </FormGroup>
        
        <FormGroup label="Zeitplan">
          <div style={{ marginBottom: 8 }}>
            <Button
              small
              minimal
              active={!useCustomCron}
              onClick={() => setUseCustomCron(false)}
            >
              Vorlagen
            </Button>
            <Button
              small
              minimal
              active={useCustomCron}
              onClick={() => setUseCustomCron(true)}
              style={{ marginLeft: 8 }}
            >
              Benutzerdefiniert
            </Button>
          </div>
          
          {!useCustomCron ? (
            <HTMLSelect
              value={cronPreset}
              onChange={(e) => setCronPreset(e.target.value)}
              fill
            >
              {CRON_PRESETS.map(preset => (
                <option key={preset.value} value={preset.value}>
                  {preset.label} - {preset.description}
                </option>
              ))}
            </HTMLSelect>
          ) : (
            <InputGroup
              placeholder="0 0 * * * (Minute Stunde Tag Monat Wochentag)"
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              leftElement={<Tag minimal>CRON</Tag>}
            />
          )}
        </FormGroup>
        
        {effectiveCron && (
          <Callout intent="none" icon="calendar" style={{ marginBottom: 16 }}>
            <strong>Ausführung:</strong> {formatCronExpression(effectiveCron)}
          </Callout>
        )}
        
        <FormGroup label="Zeitzone">
          <HTMLSelect
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            fill
          >
            <option value="Europe/Berlin">Europe/Berlin (MEZ/MESZ)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="UTC">UTC</option>
            <option value="America/New_York">America/New_York (EST/EDT)</option>
          </HTMLSelect>
        </FormGroup>
        
        {createScheduleMutation.error && (
          <Callout intent="danger" icon="error">
            {createScheduleMutation.error.message}
          </Callout>
        )}
      </DialogBody>
      
      <DialogFooter
        actions={
          <>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button
              intent="primary"
              icon="time"
              onClick={handleSubmit}
              loading={createScheduleMutation.isPending}
              disabled={!isValid}
            >
              Zeitplan erstellen
            </Button>
          </>
        }
      />
    </Dialog>
  )
}
