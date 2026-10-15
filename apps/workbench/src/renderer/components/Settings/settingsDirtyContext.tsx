import { createContext, useContext, useEffect } from 'react';

export type SettingsDirtyRegistry = {
  setDirty: (id: string, dirty: boolean) => void;
  requestClose: () => boolean;
};

export const SettingsDirtyContext = createContext<SettingsDirtyRegistry | null>(null);

export function useSettingsDirty(id: string, dirty: boolean): void {
  const registry = useContext(SettingsDirtyContext);
  useEffect(() => {
    registry?.setDirty(id, dirty);
    return () => registry?.setDirty(id, false);
  }, [dirty, id, registry]);
}
