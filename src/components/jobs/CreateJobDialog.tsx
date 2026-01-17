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
  'dbt-run': {
    label: 'dbt Run',
    icon: 'build',
    description: 'Führt dbt Models aus',
    hasTarget: true,
    targetLabel: 'Model/Tag Selector',
    targetPlaceholder: '* (alle) oder tag:marts oder model_name',
    extraParams: [
      { key: 'fullRefresh', label: 'Full Refresh (--full-refresh)', type: 'checkbox', default: false }
    ]
  },
  'dbt-test': {
    label: 'dbt Test',
    icon: 'lab-test',
    description: 'Führt dbt Tests aus',
    hasTarget: true,
    targetLabel: 'Test Selector',
    targetPlaceholder: '* (alle) oder test:generic oder model_name',
  },
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
    description: 'Importiert Daten aus externer Quelle',
    hasTarget: true,
    targetLabel: 'Import Source',
    targetPlaceholder: 'z.B. file:data.csv',
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
  }
};

// Standardmäßig verfügbare Job-Typen
const defaultJobTypes: JobType[] = ['dbt-run', 'dbt-test', 'validate', 'deploy', 'schema-deploy'];

export function CreateJobDialog({ isOpen, onClose, onJobCreated }: CreateJobDialogProps) {
  const [jobType, setJobType] = useState<JobType>('dbt-run');
  const [target, setTarget] = useState('*');
  const [params, setParams] = useState<Record<string, string | boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const startJobMutation = useStartJob();
  
  const config = jobTypeConfig[jobType];
  
  // Reset form when dialog opens
  const handleOpen = useCallback(() => {
    setJobType('dbt-run');
    setTarget('*');
    setParams({});
    setError(null);
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
      const result = await startJobMutation.mutateAsync({
        type: jobType,
        target: config.hasTarget ? target : undefined,
        params: Object.keys(params).length > 0 ? params : undefined
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
          >
            Job starten
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default CreateJobDialog;
