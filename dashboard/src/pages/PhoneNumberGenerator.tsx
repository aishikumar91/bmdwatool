import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shuffle,
  Copy,
  Download,
  Trash2,
  Search,
  Globe2,
  CheckSquare,
  Square,
  RefreshCw,
  BarChart3,
  ShieldCheck,
  FolderCheck,
  Send,
  Users,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  MessageSquare,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useValidatedVault } from '../hooks/useValidatedVault';
import { useRole } from '../hooks/useRole';
import { useSessionsQuery, useTemplatesQuery } from '../hooks/queries';
import { groupApi } from '../services/api';
import { checkNumberWithRetry } from '../utils/checkNumberWithRetry';
import { copyToClipboard } from '../utils/clipboard';
import {
  COUNTRY_PHONE_CONFIGS,
  generatePhoneNumbers,
  exportAsCsv,
  exportAsJson,
  exportAsPlainText,
  getRegions,
  toDigitsOnly,
  GROUP_PARTICIPANT_LIMIT,
  type CountryPhoneConfig,
  type GeneratedPhoneNumber,
  type DistributionMode,
  type VerificationStatus,
} from '../utils/phoneNumberGenerator';
import {
  persistValidatedNumbers,
} from '../utils/validatedNumbersStorage';
import {
  chunkArray,
  loadThrottleConfig,
  saveThrottleConfig,
  loadAutoGroupPermission,
  saveAutoGroupPermission,
  loadGroupCreateDelay,
  saveGroupCreateDelay,
  loadBroadcastMessageDelay,
  saveBroadcastMessageDelay,
  STEALTH_BROADCAST_DELAY_MS,
  detectPreset,
  THROTTLE_PRESETS,
  isStealthPacing,
  AUTOMATION_RECOMMENDED_MAX_PER_COUNTRY,
  type ThrottleConfig,
  type ThrottlePreset,
} from '../utils/verificationThrottle';
import {
  loadBroadcastQueue,
  saveBroadcastQueue,
  clearBroadcastQueue,
  createQueueFromVault,
  mergeQueueWithVault,
  getBroadcastStats,
  hasResumableBroadcast,
  type BroadcastQueueState,
} from '../utils/broadcastQueueStorage';
import { runBroadcastQueue } from '../utils/sendBroadcastThrottled';
import { waitForSessionReady } from '../utils/waitForSessionReady';
import { humanPause } from '../utils/humanDelay';
import {
  loadTemplatePairings,
  resolveTemplateForScope,
} from '../utils/templatePairings';
import {
  AutomationPanel,
  applyAutomationScope,
  scopeToTemplateScope,
  type AutomationScope,
  type PipelineStep,
} from '../components/AutomationPanel';
import './PhoneNumberGenerator.css';

const DEFAULT_SELECTED = ['GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'IN'];

function statusIcon(status?: VerificationStatus) {
  switch (status) {
    case 'valid':
      return <CheckCircle2 size={16} className="status-icon valid" />;
    case 'invalid':
      return <XCircle size={16} className="status-icon invalid" />;
    case 'checking':
      return <Loader2 size={16} className="status-icon checking animate-spin" />;
    case 'waiting':
      return <Pause size={16} className="status-icon waiting" />;
    case 'error':
      return <AlertCircle size={16} className="status-icon error" />;
    default:
      return <span className="status-icon pending">—</span>;
  }
}

export function PhoneNumberGenerator() {
  const { t } = useTranslation();
  useDocumentTitle(t('phoneNumberGenerator.title'));
  const toast = useToast();
  const { canWrite } = useRole();
  const { data: allSessions = [] } = useSessionsQuery();
  const readySessions = allSessions.filter(s => s.status === 'ready');
  const [searchParams] = useSearchParams();

  const [sessionId, setSessionId] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set(DEFAULT_SELECTED));
  const [countrySearch, setCountrySearch] = useState('');
  const [regionFilter, setRegionFilter] = useState<string>('all');
  const [count, setCount] = useState(25);
  const [distribution, setDistribution] = useState<DistributionMode>('random');
  const [dedupe, setDedupe] = useState(true);
  const [results, setResults] = useState<GeneratedPhoneNumber[]>([]);
  const [resultSearch, setResultSearch] = useState('');
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
  const [exportField, setExportField] = useState<'e164' | 'whatsappId' | 'display'>('e164');

  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyWaitingMessage, setVerifyWaitingMessage] = useState<string | null>(null);
  const [verifyProgress, setVerifyProgress] = useState({
    done: 0,
    total: 0,
    valid: 0,
    batch: 0,
    totalBatches: 0,
  });
  const verifyAbortRef = useRef(false);
  /** Sync ref so automation can apply stealth before React re-renders verify/broadcast loops. */
  const stealthPacingRef = useRef(true);

  const [throttleConfig, setThrottleConfig] = useState<ThrottleConfig>(() => loadThrottleConfig());
  const [throttlePreset, setThrottlePreset] = useState<ThrottlePreset>(() => detectPreset(loadThrottleConfig()));

  const [autoGroupPermission, setAutoGroupPermission] = useState(() => loadAutoGroupPermission());
  const [groupCreateDelay, setGroupCreateDelay] = useState(() => loadGroupCreateDelay());
  const [mobilePanel, setMobilePanel] = useState<'setup' | 'results'>('setup');

  const { vault, refreshVault, totalCount: totalVaultCount } = useValidatedVault();

  const [groupNamePrefix, setGroupNamePrefix] = useState('OpenWA Research');
  const [groupMessage, setGroupMessage] = useState('');
  const [directMessage, setDirectMessage] = useState('');
  const [isSendingGroups, setIsSendingGroups] = useState(false);
  const [groupProgress, setGroupProgress] = useState('');

  const [broadcastDelay, setBroadcastDelay] = useState(() => loadBroadcastMessageDelay());
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastWaitingMessage, setBroadcastWaitingMessage] = useState<string | null>(null);
  const [broadcastCurrent, setBroadcastCurrent] = useState<string | null>(null);
  const [broadcastProgress, setBroadcastProgress] = useState({ done: 0, total: 0, sent: 0, failed: 0 });
  const [savedBroadcastQueue, setSavedBroadcastQueue] = useState<BroadcastQueueState | null>(() =>
    loadBroadcastQueue(),
  );
  const broadcastAbortRef = useRef(false);
  const automationAbortRef = useRef(false);

  const [automationScope, setAutomationScope] = useState<AutomationScope>('europe');
  const [pipelineStep, setPipelineStep] = useState<PipelineStep>('idle');
  const [isAutomating, setIsAutomating] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [useStealthMode, setUseStealthMode] = useState(true);

  const { data: templates = [] } = useTemplatesQuery(sessionId, !!sessionId);

  const regions = useMemo(() => getRegions(), []);

  useEffect(() => {
    if (readySessions.length > 0 && !sessionId) {
      setSessionId(readySessions[0].id);
    }
  }, [readySessions, sessionId]);

  useEffect(() => {
    const queue = loadBroadcastQueue();
    setSavedBroadcastQueue(queue);
    if (queue?.message) {
      setDirectMessage(queue.message);
    }
  }, []);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    return COUNTRY_PHONE_CONFIGS.filter(c => {
      if (regionFilter !== 'all' && c.region !== regionFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dialCode.includes(q)
      );
    });
  }, [countrySearch, regionFilter]);

  const selectedCountries = useMemo(
    () => COUNTRY_PHONE_CONFIGS.filter(c => selectedCodes.has(c.code)),
    [selectedCodes],
  );

  const filteredResults = useMemo(() => {
    const q = resultSearch.trim().toLowerCase();
    if (!q) return results;
    return results.filter(
      n =>
        n.countryName.toLowerCase().includes(q) ||
        n.countryCode.toLowerCase().includes(q) ||
        n.e164.includes(q) ||
        n.whatsappId.includes(q) ||
        n.nationalNumber.includes(q) ||
        n.verificationStatus?.includes(q),
    );
  }, [results, resultSearch]);

  const statsByCountry = useMemo(() => {
    const map = new Map<string, { country: CountryPhoneConfig; count: number }>();
    for (const n of results) {
      const existing = map.get(n.countryCode);
      if (existing) existing.count++;
      else {
        const country = COUNTRY_PHONE_CONFIGS.find(c => c.code === n.countryCode);
        if (country) map.set(n.countryCode, { country, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [results]);

  const verificationStats = useMemo(() => {
    const valid = results.filter(r => r.verificationStatus === 'valid').length;
    const invalid = results.filter(r => r.verificationStatus === 'invalid').length;
    const pending = results.filter(r => !r.verificationStatus || r.verificationStatus === 'pending').length;
    return { valid, invalid, pending, total: results.length };
  }, [results]);

  const resumableBroadcast = useMemo(
    () => hasResumableBroadcast(savedBroadcastQueue),
    [savedBroadcastQueue],
  );

  const broadcastQueueStats = useMemo(() => {
    if (!savedBroadcastQueue) return null;
    return getBroadcastStats(savedBroadcastQueue);
  }, [savedBroadcastQueue]);

  const toggleCountry = (code: string) => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedCodes(prev => {
      const next = new Set(prev);
      filteredCountries.forEach(c => next.add(c.code));
      return next;
    });
  };

  const clearSelection = () => setSelectedCodes(new Set());

  const selectRandomCountries = () => {
    const shuffled = [...COUNTRY_PHONE_CONFIGS].sort(() => Math.random() - 0.5);
    const pick = shuffled.slice(0, Math.min(8, shuffled.length));
    setSelectedCodes(new Set(pick.map(c => c.code)));
  };

  const selectEurope = () => {
    setSelectedCodes(new Set(COUNTRY_PHONE_CONFIGS.filter(c => c.region === 'Europe').map(c => c.code)));
  };

  const selectAsia = () => {
    setSelectedCodes(new Set(COUNTRY_PHONE_CONFIGS.filter(c => c.region === 'Asia').map(c => c.code)));
  };

  const selectOther = () => {
    setSelectedCodes(
      new Set(COUNTRY_PHONE_CONFIGS.filter(c => c.region !== 'Europe' && c.region !== 'Asia').map(c => c.code)),
    );
  };

  const selectAllCountries = () => {
    setSelectedCodes(new Set(COUNTRY_PHONE_CONFIGS.map(c => c.code)));
  };

  useEffect(() => {
    const scope = searchParams.get('scope') as AutomationScope | null;
    if (scope && ['europe', 'asia', 'other', 'all', 'custom'].includes(scope)) {
      setAutomationScope(scope);
      applyAutomationScope(scope, {
        selectEurope,
        selectAsia,
        selectOther,
        selectAll: selectAllCountries,
      });
    }
    const tpl = searchParams.get('templateId');
    if (tpl) setSelectedTemplateId(tpl);
    if (searchParams.get('stealth') === '1') {
      setUseStealthMode(true);
      stealthPacingRef.current = true;
    }
  }, [searchParams]);

  useEffect(() => {
    if (!sessionId) return;
    const pairing = resolveTemplateForScope(
      loadTemplatePairings(),
      sessionId,
      scopeToTemplateScope(automationScope),
    );
    if (pairing) setSelectedTemplateId(pairing.templateId);
  }, [automationScope, sessionId]);

  const handleGenerate = () => {
    if (selectedCountries.length === 0) {
      toast.warning(t('phoneNumberGenerator.noCountriesSelected'));
      return;
    }

    const generated = generatePhoneNumbers({
      countries: selectedCountries,
      count: Math.min(Math.max(count, 1), 1000),
      distribution,
      dedupe,
    });

    setResults(generated);
    setSelectedResultIds(new Set());
    toast.success(
      t('phoneNumberGenerator.generatedTitle'),
      t('phoneNumberGenerator.generatedDesc', { count: generated.length }),
    );
  };

  const applyThrottlePreset = (preset: Exclude<ThrottlePreset, 'custom'>) => {
    const config = THROTTLE_PRESETS[preset];
    setThrottlePreset(preset);
    setThrottleConfig(config);
    saveThrottleConfig(config);
    const stealth = preset === 'stealth';
    setUseStealthMode(stealth);
    stealthPacingRef.current = stealth;
  };

  const handleStealthChange = (enabled: boolean) => {
    setUseStealthMode(enabled);
    if (enabled) {
      applyThrottlePreset('stealth');
    } else {
      stealthPacingRef.current = throttlePreset === 'stealth';
    }
  };

  useEffect(() => {
    if (useStealthMode && throttlePreset !== 'stealth') {
      applyThrottlePreset('stealth');
    } else {
      stealthPacingRef.current = isStealthPacing(throttlePreset, useStealthMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stealthPacingActive = () =>
    stealthPacingRef.current || isStealthPacing(throttlePreset, useStealthMode);

  const updateThrottle = (patch: Partial<ThrottleConfig>) => {
    setThrottleConfig(prev => {
      const next = { ...prev, ...patch };
      saveThrottleConfig(next);
      setThrottlePreset(detectPreset(next));
      return next;
    });
  };

  const handleAutoGroupPermission = (granted: boolean) => {
    setAutoGroupPermission(granted);
    saveAutoGroupPermission(granted);
  };

  const handleCancelVerify = () => {
    verifyAbortRef.current = true;
  };

  const handleVerifyWhatsApp = async () => {
    if (!sessionId) {
      toast.warning(t('phoneNumberGenerator.noSession'));
      return;
    }
    if (results.length === 0) {
      toast.warning(t('phoneNumberGenerator.noNumbersToVerify'));
      return;
    }
    if (!canWrite) {
      toast.warning(t('phoneNumberGenerator.viewOnly'));
      return;
    }

    const targets = selectedResultIds.size > 0 ? results.filter(r => selectedResultIds.has(r.id)) : results;
    const batches = chunkArray(targets, throttleConfig.batchSize);

    verifyAbortRef.current = false;
    setIsVerifying(true);
    setVerifyWaitingMessage(null);
    setVerifyProgress({ done: 0, total: targets.length, valid: 0, batch: 0, totalBatches: batches.length });
    let validCount = 0;
    let doneCount = 0;
    let vaultDirty = false;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      if (verifyAbortRef.current) break;

      const batch = batches[batchIndex];
      setVerifyProgress(prev => ({ ...prev, batch: batchIndex + 1 }));
      const batchValid: Array<{
        e164: string;
        whatsappId: string;
        countryCode: string;
        countryName: string;
        flag: string;
        dialCode: string;
        nationalNumber: string;
        verifiedAt: string;
      }> = [];

      for (let i = 0; i < batch.length; i++) {
        if (verifyAbortRef.current) break;

        const target = batch[i];
        setResults(prev =>
          prev.map(r => (r.id === target.id ? { ...r, verificationStatus: 'checking' as const } : r)),
        );

        try {
          const digits = toDigitsOnly(target);
          const check = await checkNumberWithRetry(sessionId, digits, {
            shouldAbort: () => verifyAbortRef.current,
            onWaiting: message => {
              setVerifyWaitingMessage(message);
              setResults(prev =>
                prev.map(r => (r.id === target.id ? { ...r, verificationStatus: 'waiting' as const } : r)),
              );
            },
          });
          setVerifyWaitingMessage(null);

          if (check.error && check.retryable && !check.exists) {
            setResults(prev =>
              prev.map(r =>
                r.id === target.id
                  ? {
                      ...r,
                      verificationStatus: 'error' as const,
                      verificationError: check.error,
                    }
                  : r,
              ),
            );
          } else {
            const updated: GeneratedPhoneNumber = {
              ...target,
              verificationStatus: check.exists ? 'valid' : 'invalid',
              verifiedWhatsappId: check.whatsappId,
              verifiedAt: new Date().toISOString(),
            };
            setResults(prev => prev.map(r => (r.id === target.id ? updated : r)));
            if (check.exists) {
              validCount++;
              if (updated.verifiedWhatsappId) {
                batchValid.push({
                  e164: updated.e164,
                  whatsappId: updated.verifiedWhatsappId,
                  countryCode: updated.countryCode,
                  countryName: updated.countryName,
                  flag: updated.flag,
                  dialCode: updated.dialCode,
                  nationalNumber: updated.nationalNumber,
                  verifiedAt: updated.verifiedAt ?? new Date().toISOString(),
                });
              }
            }
          }
        } catch (err) {
          setResults(prev =>
            prev.map(r =>
              r.id === target.id
                ? {
                    ...r,
                    verificationStatus: 'error' as const,
                    verificationError: err instanceof Error ? err.message : t('common.errorGeneric'),
                  }
                : r,
            ),
          );
        }

        doneCount++;
        setVerifyProgress({
          done: doneCount,
          total: targets.length,
          valid: validCount,
          batch: batchIndex + 1,
          totalBatches: batches.length,
        });

        const isLastInBatch = i === batch.length - 1;
        const isLastOverall = batchIndex === batches.length - 1 && isLastInBatch;
        if (!isLastOverall && !verifyAbortRef.current) {
          const delayMs = isLastInBatch
            ? throttleConfig.pauseBetweenBatchesMs
            : throttleConfig.delayBetweenChecksMs;
          if (stealthPacingActive()) {
            await humanPause(delayMs, 0.45);
          } else {
            await humanPause(delayMs, 0.25);
          }
        }
      }

      if (batchValid.length > 0) {
        await persistValidatedNumbers(batchValid);
        vaultDirty = true;
      }

      if (vaultDirty) {
        await refreshVault();
        vaultDirty = false;
      }
    }

    if (vaultDirty) {
      await refreshVault();
    }

    setIsVerifying(false);
    setVerifyWaitingMessage(null);
    if (verifyAbortRef.current) {
      toast.warning(t('phoneNumberGenerator.verifyCancelled'), t('phoneNumberGenerator.verifyCancelledDesc', { done: doneCount }));
    } else {
      toast.success(
        t('phoneNumberGenerator.verifyComplete'),
        t('phoneNumberGenerator.verifyCompleteDesc', { valid: validCount, total: targets.length }),
      );
    }
  };

  const toggleResult = (id: string) => {
    setSelectedResultIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllResults = () => {
    if (selectedResultIds.size === filteredResults.length) {
      setSelectedResultIds(new Set());
    } else {
      setSelectedResultIds(new Set(filteredResults.map(r => r.id)));
    }
  };

  const getExportNumbers = (): GeneratedPhoneNumber[] => {
    if (selectedResultIds.size > 0) {
      return results.filter(r => selectedResultIds.has(r.id));
    }
    return results;
  };

  const handleCopy = useCallback(
    async (text: string, label: string) => {
      const ok = await copyToClipboard(text);
      if (ok) toast.success(t('phoneNumberGenerator.copied'), label);
      else toast.error(t('phoneNumberGenerator.copyFailed'));
    },
    [toast, t],
  );

  const handleCopyAll = async () => {
    const nums = getExportNumbers();
    if (nums.length === 0) return;
    await handleCopy(exportAsPlainText(nums, exportField), t('phoneNumberGenerator.copyAll'));
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const nums = getExportNumbers();
    if (nums.length === 0) return;
    downloadFile(exportAsCsv(nums), `openwa-numbers-${Date.now()}.csv`, 'text/csv');
    toast.success(t('phoneNumberGenerator.exported'), 'CSV');
  };

  const handleExportJson = () => {
    const nums = getExportNumbers();
    if (nums.length === 0) return;
    downloadFile(exportAsJson(nums), `openwa-numbers-${Date.now()}.json`, 'application/json');
    toast.success(t('phoneNumberGenerator.exported'), 'JSON');
  };

  const handleClearResults = () => {
    setResults([]);
    setSelectedResultIds(new Set());
    setResultSearch('');
  };

  const runDirectBroadcast = async (queue: BroadcastQueueState, resume: boolean) => {
    if (!sessionId) {
      toast.warning(t('phoneNumberGenerator.noSession'));
      return;
    }
    if (!canWrite) {
      toast.warning(t('phoneNumberGenerator.viewOnly'));
      return;
    }

    broadcastAbortRef.current = false;
    setIsBroadcasting(true);
    setBroadcastWaitingMessage(null);
    setBroadcastCurrent(null);

    const merged = resume ? mergeQueueWithVault(queue, vault) : queue;
    merged.sessionId = sessionId;
    merged.delayMs = broadcastDelay;
    saveBroadcastQueue(merged);
    setSavedBroadcastQueue(merged);

    const stats = getBroadcastStats(merged);
    setBroadcastProgress({
      done: stats.sent + stats.failed,
      total: stats.total,
      sent: stats.sent,
      failed: stats.failed,
    });

    try {
      const finalState = await runBroadcastQueue({
        state: merged,
        sessionId,
        delayMs: broadcastDelay,
        shouldAbort: () => broadcastAbortRef.current,
        onWaiting: msg => setBroadcastWaitingMessage(msg),
        onProgress: (done, total, current) => {
          const sent = merged.contacts.filter(c => c.status === 'sent').length;
          const failed = merged.contacts.filter(c => c.status === 'failed').length;
          setBroadcastProgress({ done, total, sent, failed });
          setBroadcastCurrent(current ? `${current.countryName} · ${current.e164}` : null);
          setSavedBroadcastQueue({ ...merged, updatedAt: new Date().toISOString() });
        },
      });

      setSavedBroadcastQueue(finalState);
      const endStats = getBroadcastStats(finalState);

      if (broadcastAbortRef.current) {
        toast.warning(
          t('phoneNumberGenerator.broadcastCancelled'),
          t('phoneNumberGenerator.broadcastCancelledDesc', { sent: endStats.sent, pending: endStats.pending }),
        );
      } else {
        toast.success(
          t('phoneNumberGenerator.directBroadcastComplete'),
          t('phoneNumberGenerator.directBroadcastCompleteDesc', {
            sent: endStats.sent,
            failed: endStats.failed,
            total: endStats.total,
          }),
        );
        if (endStats.pending === 0) {
          clearBroadcastQueue();
          setSavedBroadcastQueue(null);
        }
      }
    } catch (err) {
      toast.error(
        t('phoneNumberGenerator.directBroadcastFailed'),
        err instanceof Error ? err.message : t('common.errorGeneric'),
      );
    } finally {
      setIsBroadcasting(false);
      setBroadcastWaitingMessage(null);
      setBroadcastCurrent(null);
    }
  };

  const handleStartDirectBroadcast = async () => {
    if (!directMessage.trim()) {
      toast.warning(t('phoneNumberGenerator.groupMessageRequired'));
      return;
    }
    if (vault.length === 0) {
      toast.warning(t('phoneNumberGenerator.noValidatedInVault'));
      return;
    }
    if (!autoGroupPermission) {
      toast.warning(t('phoneNumberGenerator.broadcastPermissionRequired'));
      return;
    }

    const queue = createQueueFromVault(vault, sessionId, directMessage.trim(), broadcastDelay, {
      useStealth: stealthPacingActive(),
    });
    if (queue.contacts.length === 0) {
      toast.warning(t('phoneNumberGenerator.noValidatedInVault'));
      return;
    }
    await runDirectBroadcast(queue, false);
  };

  const handleResumeDirectBroadcast = async () => {
    if (!savedBroadcastQueue) return;
    if (!autoGroupPermission) {
      toast.warning(t('phoneNumberGenerator.broadcastPermissionRequired'));
      return;
    }
    await runDirectBroadcast(savedBroadcastQueue, true);
  };

  const handleCancelBroadcast = () => {
    broadcastAbortRef.current = true;
  };

  const handleClearBroadcastQueue = () => {
    clearBroadcastQueue();
    setSavedBroadcastQueue(null);
    toast.success(t('phoneNumberGenerator.broadcastQueueCleared'));
  };

  const handleCancelAutomation = () => {
    automationAbortRef.current = true;
    verifyAbortRef.current = true;
    broadcastAbortRef.current = true;
  };

  const handleRunFullAutomation = async () => {
    if (!sessionId || !canWrite || !autoGroupPermission) {
      toast.warning(t('phoneNumberGenerator.broadcastPermissionRequired'));
      return;
    }
    if (!selectedTemplateId) {
      toast.warning(t('phoneNumberGenerator.selectTemplate'));
      return;
    }

    const pairing = resolveTemplateForScope(
      loadTemplatePairings(),
      sessionId,
      scopeToTemplateScope(automationScope),
    );
    const template = templates.find(t => t.id === selectedTemplateId)
      ?? (pairing ? templates.find(t => t.id === pairing.templateId) : undefined);
    if (!template) {
      toast.warning(t('phoneNumberGenerator.selectTemplate'));
      return;
    }

    if (count > AUTOMATION_RECOMMENDED_MAX_PER_COUNTRY) {
      toast.warning(
        t('phoneNumberGenerator.automationVolumeWarningTitle'),
        t('phoneNumberGenerator.automationVolumeWarningDesc', {
          count,
          recommended: AUTOMATION_RECOMMENDED_MAX_PER_COUNTRY,
        }),
      );
    }

    automationAbortRef.current = false;
    verifyAbortRef.current = false;
    broadcastAbortRef.current = false;
    setIsAutomating(true);

    if (useStealthMode) {
      applyThrottlePreset('stealth');
      setBroadcastDelay(STEALTH_BROADCAST_DELAY_MS);
      saveBroadcastMessageDelay(STEALTH_BROADCAST_DELAY_MS);
    }

    if (automationScope !== 'custom') {
      applyAutomationScope(automationScope, {
        selectEurope,
        selectAsia,
        selectOther,
        selectAll: selectAllCountries,
      });
    }

    const countries = COUNTRY_PHONE_CONFIGS.filter(c => selectedCodes.has(c.code));
    if (countries.length === 0) {
      toast.warning(t('phoneNumberGenerator.noCountriesSelected'));
      setIsAutomating(false);
      return;
    }

    try {
      setPipelineStep('generate');
      const generated = generatePhoneNumbers({
        countries,
        count: Math.min(Math.max(count, 1), 1000),
        distribution,
        dedupe,
      });
      setResults(generated);
      setSelectedResultIds(new Set());
      if (automationAbortRef.current) return;

      setPipelineStep('verify');
      await handleVerifyWhatsApp();
      if (automationAbortRef.current) return;

      setPipelineStep('save');
      const latestVault = await refreshVault();
      if (automationAbortRef.current) return;

      setPipelineStep('broadcast');
      const delay = useStealthMode ? STEALTH_BROADCAST_DELAY_MS : broadcastDelay;
      const queue = createQueueFromVault(latestVault, sessionId, template.body, delay, {
        templateId: template.id,
        templateName: template.name,
        useStealth: useStealthMode,
      });
      if (queue.contacts.length === 0) {
        toast.warning(t('phoneNumberGenerator.noValidatedInVault'));
        return;
      }
      await runDirectBroadcast(queue, false);
      setPipelineStep('done');
      toast.success(t('phoneNumberGenerator.automationComplete'));
    } catch (err) {
      toast.error(
        t('phoneNumberGenerator.automationFailed'),
        err instanceof Error ? err.message : t('common.errorGeneric'),
      );
    } finally {
      setIsAutomating(false);
      setPipelineStep('idle');
    }
  };

  const handleCreateGroupsAndSend = async () => {
    if (!sessionId) {
      toast.warning(t('phoneNumberGenerator.noSession'));
      return;
    }
    if (!canWrite) {
      toast.warning(t('phoneNumberGenerator.viewOnly'));
      return;
    }
    if (!groupMessage.trim()) {
      toast.warning(t('phoneNumberGenerator.groupMessageRequired'));
      return;
    }
    if (vault.length === 0) {
      toast.warning(t('phoneNumberGenerator.noValidatedInVault'));
      return;
    }
    if (!autoGroupPermission) {
      toast.warning(t('phoneNumberGenerator.groupPermissionRequired'));
      return;
    }

    setIsSendingGroups(true);
    let groupsCreated = 0;
    let messagesSent = 0;

    try {
      for (const folder of vault) {
        const participants = folder.numbers.map(n => n.whatsappId).filter(Boolean).slice(0, GROUP_PARTICIPANT_LIMIT);
        if (participants.length === 0) continue;

        const ready = await waitForSessionReady(sessionId, {
          onWaiting: msg => setGroupProgress(msg),
        });
        if (!ready) {
          throw new Error(t('phoneNumberGenerator.sessionNotRecovered'));
        }

        setGroupProgress(t('phoneNumberGenerator.creatingGroup', { country: folder.countryName }));

        const groupName = `${groupNamePrefix} — ${folder.countryName}`;
        const group = await groupApi.create(sessionId, { name: groupName, participants });
        groupsCreated++;

        setGroupProgress(t('phoneNumberGenerator.sendingToGroup', { country: folder.countryName }));
        await groupApi.sendGroupMessage(sessionId, group.id, groupMessage.trim());
        messagesSent++;

        if (groupsCreated < vault.filter(f => f.numbers.length > 0).length) {
          if (stealthPacingActive()) {
            await humanPause(groupCreateDelay, 0.4);
          } else {
            await humanPause(groupCreateDelay, 0.25);
          }
        }
      }

      toast.success(
        t('phoneNumberGenerator.groupsSentTitle'),
        t('phoneNumberGenerator.groupsSentDesc', { groups: groupsCreated, messages: messagesSent }),
      );
    } catch (err) {
      toast.error(
        t('phoneNumberGenerator.groupSendFailed'),
        err instanceof Error ? err.message : t('common.errorGeneric'),
      );
    } finally {
      setIsSendingGroups(false);
      setGroupProgress('');
    }
  };

  return (
    <div className="phone-generator-page">
      <PageHeader
        title={t('phoneNumberGenerator.title')}
        subtitle={t('phoneNumberGenerator.subtitle')}
        badge={
          <span className="generator-badge">
            <Globe2 size={14} />
            {selectedCodes.size} {t('phoneNumberGenerator.countriesSelected')} · {COUNTRY_PHONE_CONFIGS.length}{' '}
            {t('phoneNumberGenerator.totalCountries')}
          </span>
        }
      />

      <div className="session-bar">
        <div className="form-group inline">
          <label htmlFor="verify-session">{t('phoneNumberGenerator.session')}</label>
          <select id="verify-session" value={sessionId} onChange={e => setSessionId(e.target.value)}>
            {readySessions.length === 0 && <option value="">{t('phoneNumberGenerator.noReadySessions')}</option>}
            {readySessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.phone || t('phoneNumberGenerator.noPhone')})
              </option>
            ))}
          </select>
        </div>
        {readySessions.length === 0 && (
          <p className="session-hint">{t('phoneNumberGenerator.connectSessionHint')}</p>
        )}
      </div>

      <AutomationPanel
        sessionId={sessionId}
        canWrite={canWrite}
        isRunning={isAutomating}
        pipelineStep={pipelineStep}
        scope={automationScope}
        onScopeChange={setAutomationScope}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onTemplateChange={setSelectedTemplateId}
        useStealth={useStealthMode}
        onStealthChange={handleStealthChange}
        count={count}
        onCountChange={setCount}
        onRun={() => void handleRunFullAutomation()}
        onCancel={handleCancelAutomation}
        hasReadySession={readySessions.length > 0}
        permissionGranted={autoGroupPermission}
      />

      {totalVaultCount > 0 && (
        <div className="vault-link-banner">
          <FolderCheck size={22} />
          <div className="vault-link-copy">
            <strong>{t('phoneNumberGenerator.viewVerifiedBanner', { count: totalVaultCount })}</strong>
            <p>{t('phoneNumberGenerator.viewVerifiedBannerDesc')}</p>
          </div>
          <Link to="/verified-numbers" className="btn-secondary vault-link-action">
            {t('phoneNumberGenerator.openVerifiedFolder')}
          </Link>
        </div>
      )}

      <div className="generator-tabs" role="tablist" aria-label={t('phoneNumberGenerator.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'setup'}
          className={mobilePanel === 'setup' ? 'active' : ''}
          onClick={() => setMobilePanel('setup')}
        >
          {t('phoneNumberGenerator.panelSetup')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePanel === 'results'}
          className={mobilePanel === 'results' ? 'active' : ''}
          onClick={() => setMobilePanel('results')}
        >
          {t('phoneNumberGenerator.panelResults')}
          {results.length > 0 ? ` (${results.length})` : ''}
        </button>
      </div>

      <div className={`generator-layout panel-${mobilePanel}`}>
        <aside className="generator-config">
          <div className="config-section">
            <h2>{t('phoneNumberGenerator.selectCountries')}</h2>

            <div className="config-toolbar">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="search"
                  value={countrySearch}
                  onChange={e => setCountrySearch(e.target.value)}
                  placeholder={t('phoneNumberGenerator.searchCountries')}
                />
              </div>

              <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} aria-label={t('phoneNumberGenerator.region')}>
                <option value="all">{t('phoneNumberGenerator.allRegions')}</option>
                {regions.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div className="selection-actions">
              <button type="button" className="btn-ghost" onClick={selectEurope}>
                {t('phoneNumberGenerator.selectEurope')}
              </button>
              <button type="button" className="btn-ghost" onClick={selectAsia}>
                {t('phoneNumberGenerator.selectAsia')}
              </button>
              <button type="button" className="btn-ghost" onClick={selectOther}>
                {t('phoneNumberGenerator.selectOther')}
              </button>
              <button type="button" className="btn-ghost" onClick={selectAllCountries}>
                {t('phoneNumberGenerator.selectAllCountries')}
              </button>
              <button type="button" className="btn-ghost" onClick={selectAllVisible}>
                <CheckSquare size={14} />
                {t('phoneNumberGenerator.selectVisible')}
              </button>
              <button type="button" className="btn-ghost" onClick={selectRandomCountries}>
                <Shuffle size={14} />
                {t('phoneNumberGenerator.randomPick')}
              </button>
              <button type="button" className="btn-ghost" onClick={clearSelection}>
                <Square size={14} />
                {t('phoneNumberGenerator.clearAll')}
              </button>
            </div>

            <div className="country-grid">
              {filteredCountries.map(country => {
                const selected = selectedCodes.has(country.code);
                return (
                  <button
                    key={country.code}
                    type="button"
                    className={`country-chip ${selected ? 'selected' : ''}`}
                    onClick={() => toggleCountry(country.code)}
                    aria-pressed={selected}
                  >
                    <span className="country-flag">{country.flag}</span>
                    <span className="country-meta">
                      <span className="country-name">{country.name}</span>
                      <span className="country-dial">+{country.dialCode}</span>
                    </span>
                    {selected && <span className="chip-check">✓</span>}
                  </button>
                );
              })}
              {filteredCountries.length === 0 && (
                <p className="empty-hint">{t('phoneNumberGenerator.noCountriesMatch')}</p>
              )}
            </div>
          </div>

          <div className="config-section">
            <h2>{t('phoneNumberGenerator.generationSettings')}</h2>

            <div className="form-group">
              <label htmlFor="gen-count">{t('phoneNumberGenerator.quantity')}</label>
              <div className="count-control">
                <input
                  id="gen-count"
                  type="range"
                  min={1}
                  max={500}
                  value={Math.min(count, 500)}
                  onChange={e => setCount(Number(e.target.value))}
                />
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={count}
                  onChange={e => setCount(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))}
                />
              </div>
              <span className="hint">{t('phoneNumberGenerator.quantityHint')}</span>
            </div>

            <div className="form-group">
              <label>{t('phoneNumberGenerator.distribution')}</label>
              <div className="toggle-group">
                <button
                  type="button"
                  className={distribution === 'random' ? 'active' : ''}
                  onClick={() => setDistribution('random')}
                >
                  {t('phoneNumberGenerator.distributionRandom')}
                </button>
                <button
                  type="button"
                  className={distribution === 'even' ? 'active' : ''}
                  onClick={() => setDistribution('even')}
                >
                  {t('phoneNumberGenerator.distributionEven')}
                </button>
              </div>
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={dedupe} onChange={e => setDedupe(e.target.checked)} />
              <span>{t('phoneNumberGenerator.dedupe')}</span>
            </label>

            <button type="button" className="btn-generate" onClick={handleGenerate}>
              <RefreshCw size={18} />
              {t('phoneNumberGenerator.generate')}
            </button>
          </div>

          <div className="config-section throttle-section">
            <h2>{t('phoneNumberGenerator.throttleSettings')}</h2>
            <p className="section-desc">{t('phoneNumberGenerator.throttleSettingsDesc')}</p>

            <div className="form-group">
              <label>{t('phoneNumberGenerator.throttlePreset')}</label>
              <div className="toggle-group preset-group">
                {(['stealth', 'slow', 'normal', 'fast'] as const).map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className={throttlePreset === preset ? 'active' : ''}
                    onClick={() => applyThrottlePreset(preset)}
                    disabled={isVerifying}
                  >
                    {t(`phoneNumberGenerator.presets.${preset}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="batch-size">{t('phoneNumberGenerator.batchSize')}</label>
              <div className="count-control">
                <input
                  id="batch-size"
                  type="range"
                  min={1}
                  max={25}
                  value={throttleConfig.batchSize}
                  onChange={e => updateThrottle({ batchSize: Number(e.target.value) })}
                  disabled={isVerifying}
                />
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={throttleConfig.batchSize}
                  onChange={e => updateThrottle({ batchSize: Number(e.target.value) || 1 })}
                  disabled={isVerifying}
                />
              </div>
              <span className="hint">{t('phoneNumberGenerator.batchSizeHint')}</span>
            </div>

            <div className="form-group">
              <label htmlFor="check-delay">{t('phoneNumberGenerator.checkDelay')}</label>
              <div className="count-control">
                <input
                  id="check-delay"
                  type="range"
                  min={200}
                  max={5000}
                  step={100}
                  value={throttleConfig.delayBetweenChecksMs}
                  onChange={e => updateThrottle({ delayBetweenChecksMs: Number(e.target.value) })}
                  disabled={isVerifying}
                />
                <span className="delay-value">{throttleConfig.delayBetweenChecksMs}ms</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="batch-pause">{t('phoneNumberGenerator.batchPause')}</label>
              <div className="count-control">
                <input
                  id="batch-pause"
                  type="range"
                  min={500}
                  max={15000}
                  step={250}
                  value={throttleConfig.pauseBetweenBatchesMs}
                  onChange={e => updateThrottle({ pauseBetweenBatchesMs: Number(e.target.value) })}
                  disabled={isVerifying}
                />
                <span className="delay-value">{throttleConfig.pauseBetweenBatchesMs}ms</span>
              </div>
              <span className="hint">{t('phoneNumberGenerator.batchPauseHint')}</span>
            </div>
          </div>
        </aside>

        <section className="generator-results">
          {results.length > 0 && statsByCountry.length > 0 && (
            <div className="stats-row">
              <div className="stats-card total">
                <BarChart3 size={18} />
                <div>
                  <span className="stats-value">{results.length}</span>
                  <span className="stats-label">{t('phoneNumberGenerator.totalGenerated')}</span>
                </div>
              </div>
              <div className="stats-card valid-stat">
                <CheckCircle2 size={18} />
                <div>
                  <span className="stats-value">{verificationStats.valid}</span>
                  <span className="stats-label">{t('phoneNumberGenerator.onWhatsApp')}</span>
                </div>
              </div>
              {statsByCountry.slice(0, 3).map(({ country, count: c }) => (
                <div key={country.code} className="stats-card">
                  <span className="stats-flag">{country.flag}</span>
                  <div>
                    <span className="stats-value">{c}</span>
                    <span className="stats-label">{country.code}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="results-header">
            <h2>{t('phoneNumberGenerator.results')}</h2>
            {results.length > 0 && (
              <div className="results-actions">
                <button
                  type="button"
                  className="btn-verify"
                  onClick={handleVerifyWhatsApp}
                  disabled={isVerifying || !sessionId || !canWrite}
                >
                  {isVerifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  {isVerifying ? t('phoneNumberGenerator.verifying') : t('phoneNumberGenerator.verifyWhatsApp')}
                </button>
                {isVerifying && (
                  <button type="button" className="btn-secondary" onClick={handleCancelVerify}>
                    <Pause size={14} />
                    {t('phoneNumberGenerator.cancelVerify')}
                  </button>
                )}
                <select value={exportField} onChange={e => setExportField(e.target.value as typeof exportField)}>
                  <option value="e164">E.164</option>
                  <option value="whatsappId">WhatsApp ID</option>
                  <option value="display">{t('phoneNumberGenerator.displayFormat')}</option>
                </select>
                <button type="button" className="btn-secondary" onClick={handleCopyAll}>
                  <Copy size={14} />
                  {t('phoneNumberGenerator.copyAll')}
                </button>
                <button type="button" className="btn-secondary" onClick={handleExportCsv}>
                  <Download size={14} />
                  CSV
                </button>
                <button type="button" className="btn-secondary" onClick={handleExportJson}>
                  <Download size={14} />
                  JSON
                </button>
                <button type="button" className="btn-danger" onClick={handleClearResults}>
                  <Trash2 size={14} />
                  {t('phoneNumberGenerator.clearResults')}
                </button>
              </div>
            )}
          </div>

          {isVerifying && (
            <div className="verify-progress">
              <div
                className="verify-progress-bar"
                style={{ width: `${verifyProgress.total ? (verifyProgress.done / verifyProgress.total) * 100 : 0}%` }}
              />
              <span>
                {t('phoneNumberGenerator.verifyProgress', {
                  done: verifyProgress.done,
                  total: verifyProgress.total,
                  valid: verifyProgress.valid,
                })}
                {' · '}
                {t('phoneNumberGenerator.verifyBatchProgress', {
                  batch: verifyProgress.batch,
                  totalBatches: verifyProgress.totalBatches,
                })}
              </span>
              {verifyWaitingMessage && (
                <span className="verify-waiting-message">{verifyWaitingMessage}</span>
              )}
            </div>
          )}

          {results.length > 0 ? (
            <>
              <div className="results-toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="search"
                    value={resultSearch}
                    onChange={e => setResultSearch(e.target.value)}
                    placeholder={t('phoneNumberGenerator.searchResults')}
                  />
                </div>
                <span className="results-count">
                  {filteredResults.length} / {results.length}
                  {selectedResultIds.size > 0 && ` · ${selectedResultIds.size} ${t('phoneNumberGenerator.selected')}`}
                </span>
              </div>

              <div className="results-table-wrap">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>
                        <button type="button" className="th-btn" onClick={toggleAllResults} aria-label={t('phoneNumberGenerator.selectAll')}>
                          {selectedResultIds.size === filteredResults.length && filteredResults.length > 0 ? (
                            <CheckSquare size={16} />
                          ) : (
                            <Square size={16} />
                          )}
                        </button>
                      </th>
                      <th>{t('phoneNumberGenerator.colStatus')}</th>
                      <th>{t('phoneNumberGenerator.colCountry')}</th>
                      <th>{t('phoneNumberGenerator.colE164')}</th>
                      <th>{t('phoneNumberGenerator.colWhatsapp')}</th>
                      <th>{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map(row => (
                      <tr key={row.id} className={selectedResultIds.has(row.id) ? 'selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedResultIds.has(row.id)}
                            onChange={() => toggleResult(row.id)}
                            aria-label={row.e164}
                          />
                        </td>
                        <td>{statusIcon(row.verificationStatus)}</td>
                        <td>
                          <span className="cell-country">
                            <span>{row.flag}</span>
                            <span>{row.countryName}</span>
                          </span>
                        </td>
                        <td>
                          <code>{row.e164}</code>
                        </td>
                        <td>
                          <code className="muted">{row.verifiedWhatsappId ?? row.whatsappId}</code>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="icon-btn-sm"
                            onClick={() => handleCopy(row.e164, row.e164)}
                            title={t('phoneNumberGenerator.copyNumber')}
                          >
                            <Copy size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="results-cards">
                {filteredResults.map(row => (
                  <div key={row.id} className={`result-card ${selectedResultIds.has(row.id) ? 'selected' : ''}`}>
                    <div className="result-card-top">
                      <label className="checkbox-row compact">
                        <input
                          type="checkbox"
                          checked={selectedResultIds.has(row.id)}
                          onChange={() => toggleResult(row.id)}
                        />
                        <span>
                          {statusIcon(row.verificationStatus)} {row.flag} {row.countryName}
                        </span>
                      </label>
                      <button type="button" className="icon-btn-sm" onClick={() => handleCopy(row.e164, row.e164)}>
                        <Copy size={14} />
                      </button>
                    </div>
                    <code className="result-e164">{row.e164}</code>
                    <code className="result-wa">{row.verifiedWhatsappId ?? row.whatsappId}</code>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="results-empty">
              <Globe2 size={48} strokeWidth={1.25} />
              <h3>{t('phoneNumberGenerator.emptyTitle')}</h3>
              <p>{t('phoneNumberGenerator.emptyDesc')}</p>
            </div>
          )}
        </section>
      </div>

      <section className="outreach-section">
        <div className="section-header">
          <div>
            <h2>
              <Send size={20} />
              {t('phoneNumberGenerator.outreachTitle')}
            </h2>
            <p>{t('phoneNumberGenerator.outreachDesc')}</p>
          </div>
          {totalVaultCount > 0 && (
            <Link to="/verified-numbers" className="btn-secondary">
              <FolderCheck size={14} />
              {totalVaultCount} {t('phoneNumberGenerator.validatedTotal')}
            </Link>
          )}
        </div>

        {resumableBroadcast && savedBroadcastQueue && broadcastQueueStats && (
          <div className="broadcast-resume-banner">
            <div>
              <strong>{t('phoneNumberGenerator.broadcastResumeTitle')}</strong>
              <p>
                {t('phoneNumberGenerator.broadcastResumeDesc', {
                  pending: broadcastQueueStats.pending,
                  sent: broadcastQueueStats.sent,
                  total: broadcastQueueStats.total,
                })}
              </p>
            </div>
            <div className="broadcast-resume-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleClearBroadcastQueue}
                disabled={isBroadcasting}
              >
                {t('phoneNumberGenerator.clearBroadcastQueue')}
              </button>
              <button
                type="button"
                className="btn-generate"
                onClick={() => void handleResumeDirectBroadcast()}
                disabled={isBroadcasting || !sessionId || !canWrite}
              >
                {isBroadcasting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {t('phoneNumberGenerator.resumeBroadcast')}
              </button>
            </div>
          </div>
        )}

        <div className={`permission-card ${autoGroupPermission ? 'granted' : ''}`}>
          <label className="checkbox-row permission-row">
            <input
              type="checkbox"
              checked={autoGroupPermission}
              onChange={e => handleAutoGroupPermission(e.target.checked)}
            />
            <div>
              <strong>{t('phoneNumberGenerator.broadcastPermissionTitle')}</strong>
              <p>{t('phoneNumberGenerator.broadcastPermissionDesc')}</p>
            </div>
          </label>
        </div>

        <div className="outreach-grid">
          <article className="outreach-card">
            <h3>
              <MessageSquare size={18} />
              {t('phoneNumberGenerator.directBroadcast')}
            </h3>
            <p className="outreach-card-desc">{t('phoneNumberGenerator.directBroadcastDesc')}</p>

            <div className="form-group">
              <label htmlFor="broadcast-delay">{t('phoneNumberGenerator.broadcastMessageDelay')}</label>
              <div className="count-control">
                <input
                  id="broadcast-delay"
                  type="range"
                  min={1500}
                  max={30000}
                  step={500}
                  value={broadcastDelay}
                  onChange={e => {
                    const ms = Number(e.target.value);
                    setBroadcastDelay(ms);
                    saveBroadcastMessageDelay(ms);
                  }}
                  disabled={isBroadcasting}
                />
                <span className="delay-value">{broadcastDelay}ms</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="direct-message">{t('phoneNumberGenerator.directMessage')}</label>
              <textarea
                id="direct-message"
                value={directMessage}
                onChange={e => setDirectMessage(e.target.value)}
                placeholder={t('phoneNumberGenerator.directMessagePlaceholder')}
                rows={3}
                disabled={isBroadcasting}
              />
            </div>

            {isBroadcasting && (
              <div className="broadcast-progress-wrap">
                <div className="verify-progress">
                  <div
                    className="verify-progress-bar"
                    style={{
                      width: `${broadcastProgress.total ? (broadcastProgress.done / broadcastProgress.total) * 100 : 0}%`,
                    }}
                  />
                  <span>
                    {t('phoneNumberGenerator.broadcastProgress', {
                      done: broadcastProgress.done,
                      total: broadcastProgress.total,
                      sent: broadcastProgress.sent,
                      failed: broadcastProgress.failed,
                    })}
                  </span>
                  {broadcastCurrent && <span className="verify-waiting-message">{broadcastCurrent}</span>}
                  {broadcastWaitingMessage && (
                    <span className="verify-waiting-message">{broadcastWaitingMessage}</span>
                  )}
                </div>
                <button type="button" className="btn-secondary" onClick={handleCancelBroadcast}>
                  {t('phoneNumberGenerator.cancelBroadcast')}
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn-generate"
              onClick={() => void handleStartDirectBroadcast()}
              disabled={
                isBroadcasting || isSendingGroups || !sessionId || !canWrite || vault.length === 0 || !autoGroupPermission
              }
            >
              {isBroadcasting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {isBroadcasting ? t('phoneNumberGenerator.sendingDirect') : t('phoneNumberGenerator.startDirectBroadcast')}
            </button>
            <p className="hint research-note">{t('phoneNumberGenerator.directBroadcastNote')}</p>
          </article>

          <article className="outreach-card">
            <h3>
              <Users size={18} />
              {t('phoneNumberGenerator.groupBroadcast')}
            </h3>
            <p className="outreach-card-desc">{t('phoneNumberGenerator.groupBroadcastDesc')}</p>

            <div className="form-group">
              <label htmlFor="group-delay">{t('phoneNumberGenerator.groupCreateDelay')}</label>
              <div className="count-control">
                <input
                  id="group-delay"
                  type="range"
                  min={1000}
                  max={15000}
                  step={500}
                  value={groupCreateDelay}
                  onChange={e => {
                    const ms = Number(e.target.value);
                    setGroupCreateDelay(ms);
                    saveGroupCreateDelay(ms);
                  }}
                  disabled={isSendingGroups}
                />
                <span className="delay-value">{groupCreateDelay}ms</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="group-prefix">{t('phoneNumberGenerator.groupNamePrefix')}</label>
              <input
                id="group-prefix"
                type="text"
                value={groupNamePrefix}
                onChange={e => setGroupNamePrefix(e.target.value)}
                placeholder={t('phoneNumberGenerator.groupNamePlaceholder')}
              />
            </div>

            <div className="form-group">
              <label htmlFor="group-message">{t('phoneNumberGenerator.groupMessage')}</label>
              <textarea
                id="group-message"
                value={groupMessage}
                onChange={e => setGroupMessage(e.target.value)}
                placeholder={t('phoneNumberGenerator.groupMessagePlaceholder')}
                rows={3}
              />
            </div>

            {groupProgress && <p className="group-progress">{groupProgress}</p>}

            <button
              type="button"
              className="btn-generate"
              onClick={handleCreateGroupsAndSend}
              disabled={isSendingGroups || !sessionId || !canWrite || vault.length === 0 || !autoGroupPermission}
            >
              {isSendingGroups ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {isSendingGroups ? t('phoneNumberGenerator.sendingGroups') : t('phoneNumberGenerator.createGroupsAndSend')}
            </button>
            <p className="hint research-note">{t('phoneNumberGenerator.researchNote')}</p>
          </article>
        </div>
      </section>
    </div>
  );
}
