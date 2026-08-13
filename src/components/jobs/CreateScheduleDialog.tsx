'use client'

import { useState, useCallback } from 'react'
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

interface ImportableEntity {
  id: number
  code: string
  name: string
  model_code: string
  import_source_object: string | null
}

// Bewusst kein "dbt-run"/"dbt-test" mit freiem Model-Selector - masterdata soll
// dbt nie als direkten Rohbefehl ausführen, nur über strukturierte Aktionen.
const JOB_TYPES: Array<{ value: JobType; label: string; description: string }> = [
  { value: 'validate', label: 'Validierung', description: 'Datenvalidierung durchführen' },
  { value: 'deploy', label: 'Data Deploy', description: 'Daten in Data Vault deployen' },
  { value: 'schema-deploy', label: 'Schema Deploy', description: 'Schema-Änderungen deployen' },
  { value: 'import', label: 'Import', description: 'Kontinuierlicher Import aus Data-Vault-Quelle' },
]

export function CreateScheduleDialog({ isOpen, onClose, onSuccess }: CreateScheduleDialogProps) {
  const createScheduleMutation = useCreateSchedule()

  // Form state
  const [name, setName] = useState('')
  const [jobType, setJobType] = useState<JobType>('schema-deploy')
  const [target, setTarget] = useState('')
  const [cronPreset, setCronPreset] = useState<string>(CRON_PRESETS[1].value) // Daily midnight
  const [customCron, setCustomCron] = useState('')
  const [useCustomCron, setUseCustomCron] = useState(false)
  const [timezone, setTimezone] = useState('Europe/Berlin')
  const [importableEntities, setImportableEntities] = useState<ImportableEntity[]>([])
  const [importEntityId, setImportEntityId] = useState<number | null>(null)

  const effectiveCron = useCustomCron ? customCron : cronPreset

  // Load entities with a configured import source once, when the Import job
  // type is first selected (same entity-picker pattern as the manual
  // CreateJobDialog - a schedule for 'import' still needs an entity, not a
  // free-text target).
  const ensureImportableEntitiesLoaded = useCallback(() => {
    if (importableEntities.length > 0) return
    fetch('/api/entities')
      .then(res => res.json())
      .then(json => {
        const withSource = (json.data || []).filter((e: ImportableEntity) => e.import_source_object)
        setImportableEntities(withSource)
        if (withSource.length > 0) setImportEntityId(withSource[0].id)
      })
      .catch(() => setImportableEntities([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async () => {
    try {
      const selectedImportEntity = jobType === 'import'
        ? importableEntities.find(e => e.id === importEntityId)
        : undefined
      if (jobType === 'import' && !selectedImportEntity) {
        throw new Error('Bitte eine Entity mit konfigurierter Import-Quelle auswählen')
      }

      await createScheduleMutation.mutateAsync({
        type: jobType,
        target: jobType === 'import' ? selectedImportEntity!.code : target,
        schedule: {
          name,
          cron: effectiveCron,
          timezone,
        },
        params: jobType === 'import' ? { entity_id: selectedImportEntity!.id } : undefined,
      })

      // Reset form
      setName('')
      setTarget('')
      setCronPreset(CRON_PRESETS[1].value)
      setCustomCron('')
      setUseCustomCron(false)
      setImportEntityId(importableEntities[0]?.id ?? null)

      onSuccess?.()
      onClose()
    } catch {
      // Error is handled by mutation state
    }
  }
  
  const isValid = jobType === 'import'
    ? name.trim() && importEntityId && effectiveCron.trim()
    : name.trim() && target.trim() && effectiveCron.trim()

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
            onChange={(e) => {
              const newType = e.target.value as JobType
              setJobType(newType)
              if (newType === 'import') ensureImportableEntitiesLoaded()
            }}
            fill
          >
            {JOB_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label} - {type.description}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>

        {jobType === 'import' ? (
          importableEntities.length === 0 ? (
            <Callout intent="warning" icon="warning-sign" style={{ marginBottom: 16 }}>
              Keine Entity mit konfigurierter Import-Quelle gefunden. Unter Entities → Import Config zuerst eine Data-Vault-Quelle zuweisen.
            </Callout>
          ) : (
            <FormGroup
              label="Entity"
              labelInfo="(erforderlich)"
              helperText="Nur Entities mit konfigurierter Import-Quelle"
            >
              <HTMLSelect
                fill
                value={importEntityId ?? ''}
                onChange={(e) => setImportEntityId(Number(e.target.value))}
              >
                {importableEntities.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.model_code}) - {e.import_source_object}
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>
          )
        ) : (
          <FormGroup
            label="Target"
            labelInfo="(erforderlich)"
            helperText={
              jobType === 'deploy' || jobType === 'schema-deploy'
                ? 'Entity-Code(s), z.B. "customer" oder "all"'
                : 'Target-Beschreibung'
            }
          >
            <InputGroup
              placeholder="all"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </FormGroup>
        )}

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
