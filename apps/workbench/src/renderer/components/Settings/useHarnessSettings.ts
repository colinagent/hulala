import { useCallback, useEffect, useState } from 'react';

import type { HarnessSettingsNamespace } from '../../types/platform';
import {
  describeHarnessSettings,
  type HarnessSettingsDescription,
} from '../../services/harnessSettingsService';

export function useHarnessSettingsDescription() {
  const [description, setDescription] = useState<HarnessSettingsDescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDescription(await describeHarnessSettings());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceNamespace = useCallback((namespace: HarnessSettingsNamespace) => {
    setDescription((current) => current ? {
      ...current,
      namespaces: current.namespaces.map((candidate) => candidate.ns === namespace.ns ? namespace : candidate),
    } : current);
  }, []);

  return { description, loading, error, reload: load, replaceNamespace };
}
