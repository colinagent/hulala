import type { ModelEntry } from '../types/platform';
import { formatModelProviderLabel } from '../../shared/modelKeys';

export type ModelDisplayInfo = {
  primaryText: string;
  secondaryText: string | null;
  providerText: string | null;
  triggerText: string;
  titleText: string;
};

export type ModelSelectOption = {
  value: string;
  label: string;
  description?: string;
  title: string;
};

function normalizeText(value: string | null | undefined): string {
  return (value || '').trim();
}

export function getDisplayModelKeyParts(
  modelKey: string | null | undefined,
  _providerLabel?: string | null,
): {
  providerPrefix: string;
  modelId: string;
} {
  const normalizedModelKey = normalizeText(modelKey);
  if (!normalizedModelKey) {
    return { providerPrefix: '', modelId: '' };
  }

  const separatorIndex = normalizedModelKey.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= normalizedModelKey.length - 1) {
    return { providerPrefix: '', modelId: normalizedModelKey };
  }

  const providerKey = normalizedModelKey.slice(0, separatorIndex);
  const modelId = normalizedModelKey.slice(separatorIndex + 1);
  return {
    providerPrefix: `${providerKey}:`,
    modelId,
  };
}

export function getDisplayModelKeyText(
  modelKey: string | null | undefined,
  providerLabel?: string | null,
): string {
  const { providerPrefix, modelId } = getDisplayModelKeyParts(modelKey, providerLabel);
  return `${providerPrefix}${modelId}`;
}

export function getVisibleProviderLabel(
  providerKey: string | null | undefined,
  providerLabel?: string | null,
): string | null {
  return formatModelProviderLabel(providerKey, providerLabel);
}

export function getModelDisplayInfo(
  modelId: string | null | undefined,
  modelName?: string | null,
  providerLabel?: string | null,
): ModelDisplayInfo {
  const normalizedId = normalizeText(modelId);
  const normalizedName = normalizeText(modelName);
  const normalizedProviderLabel = normalizeText(providerLabel);

  const primaryText = normalizedName || normalizedId || 'Unknown model';
  const secondaryText = normalizedId && normalizedId !== primaryText ? normalizedId : null;
  const providerText = normalizedProviderLabel || null;
  const triggerText = primaryText;
  const titleParts = [primaryText];
  if (secondaryText) {
    titleParts.push(secondaryText);
  }
  if (providerText) {
    titleParts.push(providerText);
  }
  const titleText = titleParts.join(' · ');

  return {
    primaryText,
    secondaryText,
    providerText,
    triggerText,
    titleText,
  };
}

export function getModelEntryDisplay(
  model: Pick<ModelEntry, 'id' | 'label' | 'provider' | 'providerLabel'>,
): ModelDisplayInfo {
  return getModelDisplayInfo(model.id, model.label, getVisibleProviderLabel(model.provider, model.providerLabel));
}

export function buildModelSelectOption(
  model: Pick<ModelEntry, 'id' | 'label' | 'provider' | 'providerLabel' | 'key'>,
  value = model.key,
): ModelSelectOption {
  const display = getModelEntryDisplay(model);
  const descriptionParts = [display.secondaryText, display.providerText].filter(Boolean);
  return {
    value,
    label: display.primaryText,
    ...(descriptionParts.length > 0 ? { description: descriptionParts.join(' · ') } : {}),
    title: display.titleText,
  };
}
