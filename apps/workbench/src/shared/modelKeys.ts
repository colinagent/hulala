export function normalizeModelKey(value: string | null | undefined): string {
  return (value || '').trim();
}

export function normalizeProviderKey(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function isValidProviderKey(value: string | null | undefined): boolean {
  const normalized = normalizeProviderKey(value);
  return /^[a-z0-9][a-z0-9._-]*$/.test(normalized);
}

function hashProviderName(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function deriveProviderKeyFromLabel(value: string | null | undefined): string {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }
  const slug = trimmed
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-._]+$/, '')
    .replace(/[-._]{2,}/g, '-');
  const normalizedSlug = normalizeProviderKey(slug);
  if (isValidProviderKey(normalizedSlug)) {
    return normalizedSlug;
  }
  const normalizedForHash = trimmed.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();
  return `provider-${hashProviderName(normalizedForHash)}`;
}

export function buildModelKey(
  providerKey: string | null | undefined,
  modelId: string | null | undefined,
): string {
  const normalizedID = (modelId || '').trim();
  if (!normalizedID) {
    return '';
  }
  const normalizedProviderKey = normalizeProviderKey(providerKey);
  if (!normalizedProviderKey) {
    return '';
  }
  return `${normalizedProviderKey}:${normalizedID}`;
}

export function formatModelProviderLabel(
  providerKey: string | null | undefined,
  providerLabel?: string | null,
): string | null {
  const normalizedProviderKey = normalizeProviderKey(providerKey);
  const normalizedLabel = (providerLabel || '').trim();
  if (normalizedLabel) {
    return normalizedLabel;
  }
  if (!normalizedProviderKey) {
    return null;
  }
  return normalizedProviderKey;
}
