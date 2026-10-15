import React, { useEffect, useMemo } from 'react'
import type { PluginView } from '@hulala/plugin-sdk'
import { openLocalPluginView, startLocalPlugins, useLocalPlugins, type LocalView } from '../../services/localPlugins'
import { useAppStore } from '../../store/appStore'
import { useUiStore } from '../../store/uiStore'
import { IconButton } from '../IconButton'
import { SkillPuzzleIcon } from '../Icons'
export function LocalPluginIcon({ icon }: { icon?: PluginView['icon'] }) {
  return icon ? <svg className="w-5 h-5 shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icon.paths.map((path, index) => <path key={index} d={path} />)}
  </svg> : <SkillPuzzleIcon className="w-5 h-5" />
}
export interface LocalRailPluginView extends LocalView {
  selected: boolean
  activeChildKey?: string
}
/** Plugin views that belong on the activity rail, in registration order. */
export function useLocalRailPluginViews(): LocalRailPluginView[] {
  const views = useLocalPlugins(s => s.views)
  const navigations = useLocalPlugins(s => s.navigations)
  const active = useAppStore(s => s.documents.find(document => document.id === s.activeTabId)?.editorId)
  const sidebar = useUiStore(state => state.sidebarView)
  useEffect(() => startLocalPlugins(), [])
  return useMemo(() => views.filter(v => !v.settings && v.showInRail !== false).map(view => {
    const hasNavigation = navigations.some(navigation => navigation.pluginId === view.pluginId)
    const selected = hasNavigation ? sidebar === 'plugin:' + view.pluginId : active === 'plugin:' + view.key
    // Reopening the current tool keeps its active child page (for example, markets).
    const activeChild = hasNavigation ? views.find(candidate => candidate.pluginId === view.pluginId && active === 'plugin:' + candidate.key) : undefined
    return { ...view, selected, activeChildKey: activeChild?.key }
  }), [views, navigations, active, sidebar])
}
export function LocalPluginRailButton({ view, group }: { view: LocalRailPluginView; group: 'current' | 'overflow' }) {
  return <IconButton
    size={34} title={view.title} aria-label={view.title}
    aria-current={view.selected ? 'page' : undefined}
    data-sidebar-plugin={view.pluginId}
    data-sidebar-plugin-group={group}
    className={'sidebar-activity-button' + (view.selected ? ' is-active' : '')}
    style={{ color: view.selected ? 'var(--color-highlight)' : undefined, background: 'transparent' }}
    onClick={() => openLocalPluginView(view.activeChildKey ?? view.key)}
  >
    <LocalPluginIcon icon={view.icon} />
  </IconButton>
}
