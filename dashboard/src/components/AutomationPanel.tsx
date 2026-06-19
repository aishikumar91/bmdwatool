import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Zap,
  Globe2,
  Shield,
  Loader2,
  Play,
  Square,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import type { MessageTemplate } from '../services/api';
import type { TemplateScope } from '../utils/templatePairings';

export type AutomationScope = 'europe' | 'asia' | 'other' | 'all' | 'custom';

export type PipelineStep = 'idle' | 'generate' | 'verify' | 'save' | 'broadcast' | 'done';

export interface AutomationPanelProps {
  sessionId: string;
  canWrite: boolean;
  isRunning: boolean;
  pipelineStep: PipelineStep;
  scope: AutomationScope;
  onScopeChange: (scope: AutomationScope) => void;
  templates: MessageTemplate[];
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
  useStealth: boolean;
  onStealthChange: (v: boolean) => void;
  count: number;
  onCountChange: (n: number) => void;
  onRun: () => void;
  onCancel: () => void;
  hasReadySession: boolean;
  permissionGranted: boolean;
}

const SCOPE_OPTIONS: AutomationScope[] = ['europe', 'asia', 'other', 'all', 'custom'];

export function AutomationPanel({
  sessionId,
  canWrite,
  isRunning,
  pipelineStep,
  scope,
  onScopeChange,
  templates,
  selectedTemplateId,
  onTemplateChange,
  useStealth,
  onStealthChange,
  count,
  onCountChange,
  onRun,
  onCancel,
  hasReadySession,
  permissionGranted,
}: AutomationPanelProps) {
  const { t } = useTranslation();

  const steps: PipelineStep[] = ['generate', 'verify', 'save', 'broadcast'];
  const stepIndex = pipelineStep === 'idle' || pipelineStep === 'done' ? -1 : steps.indexOf(pipelineStep);

  const canStart =
    canWrite && hasReadySession && permissionGranted && sessionId && !isRunning && selectedTemplateId;

  return (
    <section className="automation-panel">
      <div className="automation-panel-header">
        <div>
          <h2>
            <Zap size={20} />
            {t('phoneNumberGenerator.automationTitle')}
          </h2>
          <p>{t('phoneNumberGenerator.automationDesc')}</p>
        </div>
        <Link to="/templates" className="btn-secondary automation-template-link">
          <FileText size={14} />
          {t('phoneNumberGenerator.manageTemplates')}
        </Link>
      </div>

      <div className="automation-grid">
        <div className="form-group">
          <label>{t('phoneNumberGenerator.automationScope')}</label>
          <div className="scope-chip-row">
            {SCOPE_OPTIONS.map(s => (
              <button
                key={s}
                type="button"
                className={`scope-chip ${scope === s ? 'active' : ''}`}
                onClick={() => onScopeChange(s)}
                disabled={isRunning}
              >
                <Globe2 size={14} />
                {t(`phoneNumberGenerator.scopes.${s}`)}
              </button>
            ))}
          </div>
          {scope === 'custom' && (
            <span className="hint">{t('phoneNumberGenerator.scopeCustomHint')}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="automation-template">{t('phoneNumberGenerator.automationTemplate')}</label>
          <select
            id="automation-template"
            value={selectedTemplateId}
            onChange={e => onTemplateChange(e.target.value)}
            disabled={isRunning || !sessionId}
          >
            <option value="">{t('phoneNumberGenerator.selectTemplate')}</option>
            {templates.map(tpl => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
          <span className="hint">{t('phoneNumberGenerator.automationTemplateHint')}</span>
        </div>

        <div className="form-group">
          <label htmlFor="automation-count">{t('phoneNumberGenerator.countPerCountry')}</label>
          <div className="count-control">
            <input
              id="automation-count"
              type="range"
              min={1}
              max={100}
              value={count}
              onChange={e => onCountChange(Number(e.target.value))}
              disabled={isRunning}
            />
            <input
              type="number"
              min={1}
              max={1000}
              value={count}
              onChange={e => onCountChange(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
              disabled={isRunning}
            />
          </div>
        </div>

        <label className="checkbox-row stealth-row">
          <input
            type="checkbox"
            checked={useStealth}
            onChange={e => onStealthChange(e.target.checked)}
            disabled={isRunning}
          />
          <div>
            <strong>
              <Shield size={14} /> {t('phoneNumberGenerator.stealthMode')}
            </strong>
            <p>{t('phoneNumberGenerator.stealthModeDesc')}</p>
          </div>
        </label>
      </div>

      {isRunning && (
        <div className="pipeline-steps">
          {steps.map((step, i) => (
            <div
              key={step}
              className={`pipeline-step ${i < stepIndex ? 'done' : ''} ${i === stepIndex ? 'active' : ''}`}
            >
              {i < stepIndex ? <CheckCircle2 size={16} /> : i === stepIndex ? <Loader2 size={16} className="animate-spin" /> : <span className="step-num">{i + 1}</span>}
              <span>{t(`phoneNumberGenerator.pipelineSteps.${step}`)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="automation-actions">
        {isRunning ? (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            <Square size={16} />
            {t('phoneNumberGenerator.cancelPipeline')}
          </button>
        ) : (
          <button type="button" className="btn-generate automation-run-btn" onClick={onRun} disabled={!canStart}>
            <Play size={18} />
            {t('phoneNumberGenerator.runFullPipeline')}
          </button>
        )}
      </div>
    </section>
  );
}

export function applyAutomationScope(
  scope: AutomationScope,
  handlers: {
    selectEurope: () => void;
    selectAsia: () => void;
    selectOther: () => void;
    selectAll: () => void;
  },
): void {
  switch (scope) {
    case 'europe':
      handlers.selectEurope();
      break;
    case 'asia':
      handlers.selectAsia();
      break;
    case 'other':
      handlers.selectOther();
      break;
    case 'all':
      handlers.selectAll();
      break;
    default:
      break;
  }
}

export function scopeToTemplateScope(scope: AutomationScope): TemplateScope {
  if (scope === 'europe') return 'europe';
  if (scope === 'asia') return 'asia';
  if (scope === 'other') return 'other';
  return 'all';
}
