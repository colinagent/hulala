import { create } from 'zustand';
import { defaultThemeId as fallbackDefaultThemeId, ThemeDefinition, themes as fallbackThemes } from '../theme/presets';
import type { SidebarView } from '../components/Sidebar/sidebarTabs';
import {
  activateTheme,
  getAvailableThemes,
  getCurrentThemeId,
  getCurrentThemePreference,
  getCurrentThemeSnapshot,
  getDefaultThemeId,
  getThemeById,
} from '../theme/runtime';

export type UnifiedSettingsSection = 'general' | 'models' | 'plugins' | 'agent-presets';
export type ConversationLaunchIntent = { kind: 'workspace' } | { kind: 'session'; sessionId: string };

type UiState = {
  availableThemes: ThemeDefinition[];
  /** Resolved active theme id. */
  themeId: string;
  /** Persisted theme selection; `system` follows the operating system. */
  themePreference: string;
  theme: ThemeDefinition;
  themeReady: boolean;
  showLineNumbers: boolean;
  sidebarView: SidebarView;
  conversationLaunch: { revision: number; intent?: ConversationLaunchIntent };
  composerOpen: boolean;
  settingsOpen: boolean;
  settingsSection: UnifiedSettingsSection;
  /** Primary sidebar content (explorer/search/etc). Activity rail stays visible when false. */
  sidebarPanelOpen: boolean;
  blockingModalIds: string[];
  hasBlockingModal: boolean;
  setThemeId: (themeId: string) => void;
  setShowLineNumbers: (showLineNumbers: boolean) => void;
  setSidebarView: (view: SidebarView) => void;
  openConversation: (intent?: ConversationLaunchIntent) => void;
  closeConversation: () => void;
  openSettings: (section?: UnifiedSettingsSection) => void;
  closeSettings: () => void;
  setSettingsSection: (section: UnifiedSettingsSection) => void;
  setSidebarPanelOpen: (open: boolean) => void;
  toggleSidebarPanel: () => void;
  registerBlockingModal: (id: string) => void;
  unregisterBlockingModal: (id: string) => void;
  hydrateThemeState: (themes: ThemeDefinition[], activeTheme: ThemeDefinition, themePreference: string) => void;
  syncThemeState: () => void;
};

function normalizeShowLineNumbers(value: unknown): boolean {
  return typeof value === 'boolean' ? value : true;
}

function resolveFallbackTheme(themes: ThemeDefinition[]): ThemeDefinition {
  return themes[0] || fallbackThemes.find((theme) => theme.id === fallbackDefaultThemeId) || fallbackThemes[0];
}

function resolveRuntimeTheme(
  themes: ThemeDefinition[],
): { preference: string; themeId: string; theme: ThemeDefinition } {
  const fallback = resolveFallbackTheme(themes);
  const preference = getCurrentThemePreference() || '';
  const runtimeThemeId = getCurrentThemeId() || getDefaultThemeId();
  const currentTheme = getThemeById(runtimeThemeId);
  if (currentTheme) {
    return {
      preference: preference || currentTheme.id,
      themeId: currentTheme.id,
      theme: currentTheme,
    };
  }
  const snapshot = getCurrentThemeSnapshot();
  if (snapshot && snapshot.themeId === runtimeThemeId) {
    return {
      preference: preference || runtimeThemeId,
      themeId: runtimeThemeId,
      theme: {
        ...fallback,
        id: snapshot.themeId,
        label: snapshot.label,
        scheme: snapshot.scheme,
      },
    };
  }
  return {
    preference: preference || fallback.id,
    themeId: fallback.id,
    theme: fallback,
  };
}

function normalizeBlockingModalId(id: string): string {
  return id.trim();
}

const initialRuntimeTheme = (() => {
  const available = getAvailableThemes();
  return resolveRuntimeTheme(available);
})();

export const useUiStore = create<UiState>((set) => ({
  availableThemes: getAvailableThemes(),
  themeId: initialRuntimeTheme.themeId,
  themePreference: initialRuntimeTheme.preference,
  theme: initialRuntimeTheme.theme,
  themeReady: false,
  showLineNumbers: true,
  sidebarView: 'workspace',
  conversationLaunch: { revision: 0 },
  composerOpen: false,
  settingsOpen: false,
  settingsSection: 'general',
  sidebarPanelOpen: true,
  blockingModalIds: [],
  hasBlockingModal: false,
  setThemeId: (themePreference) => {
    const theme = activateTheme(themePreference);
    set({
      availableThemes: getAvailableThemes(),
      themePreference: getCurrentThemePreference() || theme.id,
      themeId: theme.id,
      theme,
      themeReady: true,
    });
  },
  setShowLineNumbers: (showLineNumbers) => {
    set({
      showLineNumbers: normalizeShowLineNumbers(showLineNumbers),
    });
  },
  setSidebarView: (view) => {
    set({ sidebarView: view, sidebarPanelOpen: true });
  },
  openConversation: (intent) => {
    set((state) => ({
      composerOpen: true,
      conversationLaunch: { revision: state.conversationLaunch.revision + 1, ...(intent ? { intent } : {}) },
    }));
  },
  closeConversation: () => set({ composerOpen: false }),
  openSettings: (section = 'general') => set({ settingsOpen: true, settingsSection: section }),
  closeSettings: () => set({ settingsOpen: false }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setSidebarPanelOpen: (open) => {
    set({ sidebarPanelOpen: open });
  },
  toggleSidebarPanel: () => {
    set((state) => ({ sidebarPanelOpen: !state.sidebarPanelOpen }));
  },
  registerBlockingModal: (id) => set((state) => {
    const normalizedId = normalizeBlockingModalId(id);
    if (!normalizedId || state.blockingModalIds.includes(normalizedId)) {
      return {};
    }
    const blockingModalIds = [...state.blockingModalIds, normalizedId];
    return {
      blockingModalIds,
      hasBlockingModal: blockingModalIds.length > 0,
    };
  }),
  unregisterBlockingModal: (id) => set((state) => {
    const normalizedId = normalizeBlockingModalId(id);
    if (!normalizedId || !state.blockingModalIds.includes(normalizedId)) {
      return {};
    }
    const blockingModalIds = state.blockingModalIds.filter((existingId) => existingId !== normalizedId);
    return {
      blockingModalIds,
      hasBlockingModal: blockingModalIds.length > 0,
    };
  }),
  hydrateThemeState: (themes, activeTheme, themePreference) => {
    set({
      availableThemes: themes,
      themePreference: themePreference || activeTheme.id,
      themeId: activeTheme.id,
      theme: activeTheme,
      themeReady: true,
    });
  },
  syncThemeState: () => {
    const available = getAvailableThemes();
    const current = resolveRuntimeTheme(available);
    set({
      availableThemes: available,
      themePreference: current.preference,
      themeId: current.themeId,
      theme: current.theme,
      themeReady: true,
    });
  },
}));
