/**
 * CreateJobDialog Component
 * 
 * Dialog zum manuellen Erstellen und Starten von Jobs.
 * Unterstützt verschiedene Job-Typen mit dynamischen Parametern.
 */

'use client';

import { useState, useCallback } from 'react';
import {
  Dialog,
  Button,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Checkbox,
  Classes,
  Callout,
  Tag,
  Icon
} from '@blueprintjs/core';
import { useStartJob, type JobType } from '@/hooks/useJobs';

interface ImportableEntity {
  id: number;
  code: string;
  name: string;
  model_code: string;
  import_source_object: string | null;
}

interface CreateJobDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated?: (jobId: string, jobName: string) => void;
}

// Job-Typ Konfiguration mit Metadaten
const jobTypeConfig: Record<JobType, {
  label: string;
  icon: string;
  description: string;
  hasTarget: boolean;
  targetLabel?: string;
  targetPlaceholder?: string;
  extraParams?: { key: string; label: string; type: 'checkbox' | 'text'; default?: string | boolean }[];
}> = {
  'validate': {
    label: 'Validierung',
    icon: 'tick-circle',
    description: 'Validiert Daten gegen definierte Regeln',
    hasTarget: true,
    targetLabel: 'Entity Code',
    targetPlaceholder: 'z.B. company_client',
  },
  'deploy': {
    label: 'Data Deploy',
    icon: 'cloud-upload',
    description: 'Deployed Daten aus Staging',
    hasTarget: true,
    targetLabel: 'Entity Code(s)',
    targetPlaceholder: 'z.B. company_client oder * für alle',
    extraParams: [
      { key: 'deployMode', label: 'Deploy Mode', type: 'text', default: 'full' }
    ]
  },
  'schema-deploy': {
    label: 'Schema Deploy',
    icon: 'database',
    description: 'Deployed Schema-Änderungen',
    hasTarget: false,
  },
  'import': {
    label: 'Import',
    icon: 'import',
    description: 'Importiert Daten aus der konfigurierten Data-Vault-Quelle einer Entity',
    // No free-text target - rendered as an entity picker below instead,
    // limited to entities that actually have an import source configured
    // (Settings -> Entities -> Import Config).
    hasTarget: false,
  },
  'export': {
    label: 'Export',
    icon: 'export',
    description: 'Exportiert Daten in externes Format',
    hasTarget: true,
    targetLabel: 'Export Target',
    targetPlaceholder: 'z.B. csv oder json',
  },
  'sync': {
    label: 'Sync',
    icon: 'refresh',
    description: 'Synchronisiert Daten mit externem System',
    hasTarget: true,
    targetLabel: 'Sync Target',
    targetPlaceholder: 'z.B. erp oder crm',
  },
  'cleanup': {
    label: 'Cleanup',
    icon: 'trash',
    description: 'Bereinigt alte oder temporäre Daten',
    hasTarget: false,
    extraParams: [
      { key: 'olderThanDays', label: 'Älter als (Tage)', type: 'text', default: '30' }
    ]
  },
  'github-action': {
    // Not offered in defaultJobTypes below - these jobs are only ever created
    // by the "Trigger" button on the Config page, never started by hand here
    // with a free-text target (that's exactly the unstructured dbt-run/dbt-test
    // pattern this dialog intentionally no longer supports).
    label: 'GitHub Action',
    icon: 'git-branch',
    description: 'Beobachtet einen extern laufenden GitHub Actions Workflow',
    hasTarget: false,
  }
};

// Standardmäßig verfügbare Job-Typen - bewusst nur strukturierte, entity-/commit-
// gebundene Aktionen. Kein "dbt-run"/"dbt-test" mit freiem Model-Selector:
// masterdata soll dbt nie als direkten Rohbefehl ausführen können. 'import'
// is entity-bound too (picks from a dropdown, see below), not a free-text
// source string.
const defaultJobTypes: JobType[] = ['validate', 'deploy', 'schema-deploy', 'import'];

export function CreateJobDialog({ isOpen, onClose, onJobCreated }: CreateJobDialogProps) {
  const [jobType, setJobType] = useState<JobType>('schema-deploy');
  const [target, setTarget] = useState('*');
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importableEntities, setImportableEntities] = useState<ImportableEntity[]>([]);
  const [importEntityId, setImportEntityId] = useState<number | null>(null);

  const startJobMutation = useStartJob();

  const config = jobTypeConfig[jobType];

  // Reset form when dialog opens, and load entities that have an import
  // source configured (Settings -> Entities -> Import Config) for the
  // Import job type's entity picker.
  const handleOpen = useCallback(() => {
    setJobType('schema-deploy');
    setTarget('*');
    setParams({});
    setError(null);
    setImportEntityId(null);
    fetch('/api/entities')
      .then(res => res.json())
      .then(json => {
        const withSource = (json.data || []).filter((e: ImportableEntity) => e.import_source_object);
        setImportableEntities(withSource);
        if (withSource.length > 0) setImportEntityId(withSource[0].id);
      })
      .catch(() => setImportableEntities([]));
  }, []);

  // Handle job type change - reset target and params
  const handleJobTypeChange = (newType: JobType) => {
    setJobType(newType);
    const newConfig = jobTypeConfig[newType];
    setTarget(newConfig.hasTarget ? '*' : '');

    // Set default params
    const defaultParams: Record<string, string | boolean> = {};
    newConfig.extraParams?.forEach(param => {
      if (param.default !== undefined) {
        defaultParams[param.key] = param.default;
      }
    });
    setParams(defaultParams);
  };
  
  // Handle param change
  const handleParamChange = (key: string, value: string | boolean) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };
  
  // Submit job
  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const selectedImportEntity = jobType === 'import'
        ? importableEntities.find(e => e.id === importEntityId)
        : undefined;
      if (jobType === 'import' && !selectedImportEntity) {
        throw new Error('Bitte eine Entity mit konfigurierter Import-Quelle auswählen');
      }

      const result = await startJobMutation.mutateAsync({
        type: jobType,
        target: jobType === 'import' ? selectedImportEntity!.code : (config.hasTarget ? target : undefined),
        params: jobType === 'import'
          ? { entity_id: selectedImportEntity!.id }
          : (Object.keys(params).length > 0 ? params : undefined)
      });
      
      // Notify parent
      if (onJobCreated && result.job?.id) {
        onJobCreated(result.job.id, result.job.name || `${config.label} Job`);
      }
      
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Job konnte nicht gestartet werden');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      onOpening={handleOpen}
      title="Neuen Job starten"
      icon="add"
      style={{ width: 500 }}
    >
      <div className={Classes.DIALOG_BODY}>
        {error && (
          <Callout intent="danger" icon="error" style={{ marginBottom: 16 }}>
            {error}
          </Callout>
        )}
        
        {/* Job Type Selection */}
        <FormGroup label="Job-Typ" labelFor="job-type">
          <HTMLSelect
            id="job-type"
            value={jobType}
            onChange={e => handleJobTypeChange(e.target.value as JobType)}
            fill
          >
            {defaultJobTypes.map(type => (
              <option key={type} value={type}>
                {jobTypeConfig[type].label}
              </option>
            ))}
          </HTMLSelect>
        </FormGroup>
        
        {/* Job Type Info */}
        <Callout icon="info-sign" intent="primary" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon={config.icon as any} />
            <span>{config.description}</span>
          </div>
        </Callout>
        
        {/* Target Input */}
        {config.hasTarget && (
          <FormGroup
            label={config.targetLabel || 'Target'}
            labelFor="job-target"
            helperText={config.targetPlaceholder}
          >
            <InputGroup
              id="job-target"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder={config.targetPlaceholder}
              leftIcon="locate"
            />
          </FormGroup>
        )}

        {/* Import: entity picker, limited to entities with an import source configured */}
        {jobType === 'import' && (
          importableEntities.length === 0 ? (
            <Callout intent="warning" icon="warning-sign" style={{ marginBottom: 16 }}>
              Keine Entity mit konfigurierter Import-Quelle gefunden. Unter Entities → Import Config zuerst eine Data-Vault-Quelle zuweisen.
            </Callout>
          ) : (
            <FormGroup
              label="Entity"
              labelFor="import-entity"
              helperText="Nur Entities mit konfigurierter Import-Quelle"
            >
              <HTMLSelect
                id="import-entity"
                fill
                value={importEntityId ?? ''}
                onChange={e => setImportEntityId(Number(e.target.value))}
              >
                {importableEntities.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.model_code}) - {e.import_source_object}
                  </option>
                ))}
              </HTMLSelect>
            </FormGroup>
          )
        )}
        
        {/* Extra Parameters */}
        {config.extraParams?.map(param => (
          <FormGroup key={param.key} label={param.label} labelFor={`param-${param.key}`}>
            {param.type === 'checkbox' ? (
              <Checkbox
                id={`param-${param.key}`}
                checked={params[param.key] as boolean ?? param.default ?? false}
                onChange={e => handleParamChange(param.key, (e.target as HTMLInputElement).checked)}
                label={param.label}
              />
            ) : (
              <InputGroup
                id={`param-${param.key}`}
                value={params[param.key] as string ?? param.default ?? ''}
                onChange={e => handleParamChange(param.key, e.target.value)}
              />
            )}
          </FormGroup>
        ))}
        
        {/* Job Preview */}
        <div style={{ marginTop: 16, padding: 12, background: 'var(--card-bg-secondary, #f5f8fa)', borderRadius: 4 }}>
          <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>JOB VORSCHAU</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Tag icon={config.icon as any} minimal>
              {config.label}
            </Tag>
            {config.hasTarget && target && (
              <Tag minimal>
                Target: <code>{target}</code>
              </Tag>
            )}
            {Object.entries(params).map(([key, value]) => (
              value && (
                <Tag key={key} minimal>
                  {key}: {String(value)}
                </Tag>
              )
            ))}
          </div>
        </div>
      </div>
      
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={onClose} disabled={isSubmitting}>
            Abbrechen
          </Button>
          <Button
            intent="primary"
            icon="play"
            onClick={handleSubmit}
            loading={isSubmitting}
            disabled={jobType === 'import' && (importableEntities.length === 0 || !importEntityId)}
          >
            Job starten
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default CreateJobDialog;
