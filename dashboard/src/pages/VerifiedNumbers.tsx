import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FolderCheck,
  Globe2,
  Hash,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useValidatedVault } from '../hooks/useValidatedVault';
import {
  clearCountryVaultRemote,
  clearVaultRemote,
  removeValidatedNumberRemote,
  saveAllVaultToServer,
} from '../utils/validatedNumbersStorage';
import {
  exportVerifiedNumbersTxt,
  type VerifiedExportField,
} from '../utils/exportValidatedNumbers';
import './VerifiedNumbers.css';

export function VerifiedNumbers() {
  const { t } = useTranslation();
  useDocumentTitle(t('verifiedNumbers.title'));
  const toast = useToast();
  const { vault, loading, refreshVault, totalCount } = useValidatedVault();

  const [search, setSearch] = useState('');
  const [exportField, setExportField] = useState<VerifiedExportField>('e164');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  const countryCount = vault.length;

  const filteredVault = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vault;
    return vault
      .map(folder => {
        const countryMatch =
          folder.countryName.toLowerCase().includes(q) ||
          folder.countryCode.toLowerCase().includes(q);
        const numbers = folder.numbers.filter(
          n => n.e164.includes(q) || n.whatsappId.includes(q) || countryMatch,
        );
        if (countryMatch) return folder;
        if (numbers.length === 0) return null;
        return { ...folder, numbers };
      })
      .filter((f): f is (typeof vault)[number] => f !== null);
  }, [vault, search]);

  const toggleFolder = (code: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleExportTxt = () => {
    if (totalCount === 0) {
      toast.warning(t('verifiedNumbers.nothingToExport'));
      return;
    }
    const data = search.trim() ? filteredVault : vault;
    exportVerifiedNumbersTxt(data, exportField, `verified-numbers-${Date.now()}.txt`);
    toast.success(t('verifiedNumbers.exported'));
  };

  const handleSync = async () => {
    if (vault.length === 0) return;
    setIsSaving(true);
    try {
      const count = await saveAllVaultToServer(vault);
      toast.success(t('verifiedNumbers.syncedTitle'), t('verifiedNumbers.syncedDesc', { count }));
    } catch (err) {
      toast.error(
        t('verifiedNumbers.syncFailed'),
        err instanceof Error ? err.message : t('common.errorGeneric'),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAll = async () => {
    await clearVaultRemote();
    await refreshVault();
    toast.success(t('verifiedNumbers.cleared'));
  };

  return (
    <div className="verified-page">
      <PageHeader title={t('verifiedNumbers.title')} subtitle={t('verifiedNumbers.subtitle')} />

      <div className="verified-kpi-row">
        <div className="verified-kpi">
          <FolderCheck size={22} className="text-primary" />
          <div>
            <strong>{totalCount}</strong>
            <span>{t('verifiedNumbers.totalNumbers')}</span>
          </div>
        </div>
        <div className="verified-kpi">
          <Globe2 size={22} className="text-primary" />
          <div>
            <strong>{countryCount}</strong>
            <span>{t('verifiedNumbers.countryFolders')}</span>
          </div>
        </div>
      </div>

      <div className="verified-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('verifiedNumbers.searchPlaceholder')}
          />
        </div>
        <select
          value={exportField}
          onChange={e => setExportField(e.target.value as VerifiedExportField)}
          aria-label={t('verifiedNumbers.exportFormat')}
        >
          <option value="e164">{t('verifiedNumbers.formatE164')}</option>
          <option value="whatsappId">{t('verifiedNumbers.formatWhatsApp')}</option>
          <option value="both">{t('verifiedNumbers.formatBoth')}</option>
        </select>
        <div className="verified-toolbar-actions">
          <button type="button" className="btn-secondary" onClick={() => void refreshVault()} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {t('common.refresh')}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void handleSync()} disabled={isSaving || totalCount === 0}>
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('verifiedNumbers.syncServer')}
          </button>
          <button type="button" className="btn-generate" onClick={handleExportTxt} disabled={totalCount === 0}>
            <Download size={14} />
            {t('verifiedNumbers.exportTxt')}
          </button>
          {totalCount > 0 && (
            <button type="button" className="btn-danger" onClick={() => void handleClearAll()}>
              <Trash2 size={14} />
              {t('verifiedNumbers.clearAll')}
            </button>
          )}
        </div>
      </div>

      {loading && vault.length === 0 ? (
        <div className="verified-loading">
          <Loader2 size={32} className="animate-spin" />
          <span>{t('common.loading')}</span>
        </div>
      ) : filteredVault.length === 0 ? (
        <div className="verified-empty">
          <FolderCheck size={48} strokeWidth={1.25} />
          <h3>{t('verifiedNumbers.emptyTitle')}</h3>
          <p>{t('verifiedNumbers.emptyDesc')}</p>
          <Link to="/number-generator" className="verified-link-btn">
            <Hash size={16} />
            {t('verifiedNumbers.goToGenerator')}
          </Link>
        </div>
      ) : (
        <div className="verified-folders">
          {filteredVault.map(folder => {
            const isOpen = expanded.has(folder.countryCode);
            return (
              <article key={folder.countryCode} className="verified-folder">
                <button
                  type="button"
                  className="verified-folder-head"
                  onClick={() => toggleFolder(folder.countryCode)}
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span aria-hidden>{folder.flag}</span>
                  <span className="verified-folder-name">{folder.countryName}</span>
                  <span className="verified-folder-count">{folder.numbers.length}</span>
                </button>
                {isOpen && (
                  <>
                    <div className="verified-folder-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() =>
                          exportVerifiedNumbersTxt(
                            [folder],
                            exportField,
                            `verified-${folder.countryCode.toLowerCase()}-${Date.now()}.txt`,
                          )
                        }
                      >
                        <Download size={12} />
                        {t('verifiedNumbers.exportFolder')}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => void clearCountryVaultRemote(folder.countryCode).then(refreshVault)}
                      >
                        <Trash2 size={12} />
                        {t('verifiedNumbers.clearFolder')}
                      </button>
                    </div>
                    <div className="verified-number-list">
                      {folder.numbers.map(n => (
                        <div key={n.e164} className="verified-number-row">
                          <code>{n.e164}</code>
                          <button
                            type="button"
                            className="icon-btn-sm"
                            onClick={() => void removeValidatedNumberRemote(folder.countryCode, n.e164).then(refreshVault)}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 size={12} />
                          </button>
                          <code className="muted">{n.whatsappId}</code>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
