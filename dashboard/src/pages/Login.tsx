import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Languages, KeyRound, Copy, Loader2, RefreshCw } from 'lucide-react';
import { GithubIcon } from '../components/GithubIcon';
import { AppLogo } from '../components/AppLogo';
import { languageOptions, resolveSupportedLanguage, type SupportedLanguage } from '../i18n';
import { authBootstrapApi } from '../services/api';
import { copyToClipboard } from '../utils/clipboard';
import './Login.css';

interface LoginProps {
  onLogin: (apiKey: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const { t, i18n } = useTranslation();
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapHint, setBootstrapHint] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [bootstrapAllowed, setBootstrapAllowed] = useState(true);
  const [apiOffline, setApiOffline] = useState(false);
  const [hasKeyFile, setHasKeyFile] = useState(false);
  const currentLang = resolveSupportedLanguage(i18n.resolvedLanguage || i18n.language);

  const loadBootstrapStatus = useCallback(async () => {
    try {
      const status = await authBootstrapApi.status();
      setApiOffline(false);
      setBootstrapAllowed(status.allowed);
      setHasKeyFile(status.hasKeyFile);
      if (status.hint) setBootstrapHint(status.hint);
    } catch {
      setApiOffline(true);
      setBootstrapHint(t('login.apiOffline'));
    }
  }, [t]);

  useEffect(() => {
    void loadBootstrapStatus();
  }, [loadBootstrapStatus]);

  const changeLanguage = (language: SupportedLanguage) => {
    void i18n.changeLanguage(language);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError(t('login.apiKeyRequired'));
      return;
    }
    setIsLoading(true);
    setError('');

    try {
      const data = await authBootstrapApi.validate(apiKey.trim());
      if (data.valid) {
        onLogin(apiKey.trim());
      } else {
        setError(t('login.invalidKey'));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('login.connectionError');
      setError(message);
      if (/cannot reach|npm run dev|2785/i.test(message)) {
        setApiOffline(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateKey = async (force = false) => {
    setIsGenerating(true);
    setError('');
    setGenerateMessage(null);

    try {
      const result = await authBootstrapApi.generate(force);
      setApiOffline(false);
      setGeneratedKey(result.apiKey);
      setApiKey(result.apiKey);
      setShowKey(true);
      setGenerateMessage(
        result.recovered ? t('login.keyRecovered') : result.message || t('login.keyGenerated'),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t('login.generateFailed');
      setError(message);
      if (/not reachable|Network error|fetch failed/i.test(message)) {
        setApiOffline(true);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyGenerated = async () => {
    if (!generatedKey) return;
    const ok = await copyToClipboard(generatedKey);
    if (ok) setGenerateMessage(t('login.keyCopied'));
  };

  const generateLabel = hasKeyFile ? t('login.recoverApiKey') : t('login.generateApiKey');

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">
          <AppLogo variant="login" />
          <span className="version-info">
            {t('login.version', {
              version: __APP_VERSION__,
              date: new Date(__BUILD_TIME__).toLocaleDateString(),
            })}
          </span>
        </div>

        {apiOffline && (
          <div className="login-offline-banner" role="alert">
            <p>{t('login.apiOffline')}</p>
            <button type="button" className="login-retry-btn" onClick={() => void loadBootstrapStatus()}>
              <RefreshCw size={14} />
              {t('login.retryConnection')}
            </button>
          </div>
        )}

        <div className="login-language">
          <Languages size={18} />
          <select
            value={currentLang}
            onChange={event => changeLanguage(event.target.value as SupportedLanguage)}
            aria-label={t('common.language')}
          >
            {languageOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <label htmlFor="apiKey">{t('login.apiKey')}</label>
            <div className="input-wrapper">
              <input
                id="apiKey"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={t('login.apiKeyPlaceholder')}
                className={error ? 'error' : ''}
                autoComplete="off"
              />
              <button type="button" className="toggle-visibility" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {error && <span className="error-message">{error}</span>}
          </div>

          {bootstrapAllowed && (
            <div className="login-generate-block">
              {bootstrapHint && !generatedKey && !apiOffline && (
                <p className="login-bootstrap-hint">{bootstrapHint}</p>
              )}
              <button
                type="button"
                className="generate-key-btn"
                onClick={() => void handleGenerateKey(false)}
                disabled={isGenerating || isLoading || apiOffline}
              >
                {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
                {isGenerating ? t('login.generatingKey') : generateLabel}
              </button>
              {hasKeyFile && (
                <button
                  type="button"
                  className="generate-key-btn secondary"
                  onClick={() => void handleGenerateKey(true)}
                  disabled={isGenerating || isLoading || apiOffline}
                >
                  {t('login.regenerateApiKey')}
                </button>
              )}
            </div>
          )}

          {!bootstrapAllowed && (
            <p className="login-bootstrap-hint">{t('login.generateDisabled')}</p>
          )}

          {generatedKey && (
            <div className="generated-key-banner">
              <p>{generateMessage ?? t('login.keyGenerated')}</p>
              <code>{generatedKey}</code>
              <button type="button" className="copy-key-btn" onClick={() => void handleCopyGenerated()}>
                <Copy size={16} />
                {t('login.copyKey')}
              </button>
            </div>
          )}

          <button type="submit" className="connect-btn" disabled={isLoading || apiOffline}>
            {isLoading ? t('login.connecting') : t('login.connect')}
          </button>
        </form>

        <p className="login-help">
          {t('login.help')}{' '}
          <a href="https://github.com/aishikumar91/bmdwatool" target="_blank" rel="noopener noreferrer">
            {t('login.viewDocs')}
          </a>
        </p>
      </div>

      <footer className="login-footer">
        <span>{t('login.footer')}</span>
        <a
          href="https://github.com/aishikumar91/bmdwatool"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          aria-label="GitHub"
        >
          <GithubIcon size={18} />
        </a>
      </footer>
    </div>
  );
}
