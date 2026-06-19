export type TemplateScope = 'all' | 'europe' | 'asia' | 'other' | 'country';

export interface TemplatePairing {
  templateId: string;
  templateName: string;
  sessionId: string;
  scope: TemplateScope;
  countryCode?: string;
  updatedAt: string;
}

const STORAGE_KEY = 'openwa_template_pairings';

export function loadTemplatePairings(): TemplatePairing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TemplatePairing[];
  } catch {
    return [];
  }
}

export function saveTemplatePairing(pairing: Omit<TemplatePairing, 'updatedAt'>): TemplatePairing[] {
  const list = loadTemplatePairings().filter(
    p => !(p.templateId === pairing.templateId && p.sessionId === pairing.sessionId),
  );
  const next: TemplatePairing = { ...pairing, updatedAt: new Date().toISOString() };
  list.push(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return list;
}

export function removeTemplatePairing(templateId: string, sessionId: string): TemplatePairing[] {
  const list = loadTemplatePairings().filter(
    p => !(p.templateId === templateId && p.sessionId === sessionId),
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return list;
}

export function resolveTemplateForScope(
  pairings: TemplatePairing[],
  sessionId: string,
  scope: TemplateScope,
  countryCode?: string,
): TemplatePairing | null {
  const forSession = pairings.filter(p => p.sessionId === sessionId);
  if (countryCode) {
    const country = forSession.find(p => p.scope === 'country' && p.countryCode === countryCode);
    if (country) return country;
  }
  const regional = forSession.find(p => p.scope === scope);
  if (regional) return regional;
  return forSession.find(p => p.scope === 'all') ?? null;
}

export const TEMPLATE_SCOPE_OPTIONS: TemplateScope[] = ['all', 'europe', 'asia', 'other', 'country'];
