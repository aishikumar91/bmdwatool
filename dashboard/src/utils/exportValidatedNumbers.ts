import type { CountryVault } from './validatedNumbersStorage';

export type VerifiedExportField = 'e164' | 'whatsappId' | 'both';

export function buildVerifiedNumbersTxt(
  vault: CountryVault[],
  field: VerifiedExportField = 'e164',
  includeHeaders = true,
): string {
  const lines: string[] = [];
  for (const folder of vault) {
    if (includeHeaders) {
      lines.push(`# ${folder.flag} ${folder.countryName} (${folder.countryCode}) — ${folder.numbers.length}`);
    }
    for (const n of folder.numbers) {
      if (field === 'e164') lines.push(n.e164);
      else if (field === 'whatsappId') lines.push(n.whatsappId);
      else lines.push(`${n.e164}\t${n.whatsappId}`);
    }
    if (includeHeaders) lines.push('');
  }
  return lines.join('\n').trim();
}

export function downloadTextFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportVerifiedNumbersTxt(
  vault: CountryVault[],
  field: VerifiedExportField,
  filename = 'verified-numbers.txt',
): void {
  downloadTextFile(buildVerifiedNumbersTxt(vault, field), filename);
}
