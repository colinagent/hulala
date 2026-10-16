import React from 'react'
import { openLocalPluginView, useLocalPlugins } from '../../services/localPlugins'
import { useAppStore } from '../../store/appStore'
import { LocalPluginIcon } from './LocalPluginButtons'

export function LocalPluginSidebar({ pluginId }: { pluginId: string }) {
  const navigation = useLocalPlugins(state => state.navigations.find(value => value.pluginId === pluginId))
  const views = useLocalPlugins(state => state.views)
  const editorId = useAppStore(state => state.documents.find(document => document.id === state.activeTabId)?.editorId)
  if (!navigation) return <div className="p-4 text-sm text-secondary-text">插件导航尚未加载或已停用。</div>
  const active = navigation.items.find(item => editorId === 'plugin:' + pluginId + '/' + item.viewId)
    ?? (editorId?.startsWith('plugin:' + pluginId + '/') ? navigation.items[0] : undefined)
  return <section className="flex h-full min-w-0 flex-col" data-plugin-navigation={pluginId}>
    <header className="ui-tabbar sidebar-root-header flex shrink-0 items-center px-3">
      <span className="ui-chrome-row-label">{navigation.title}</span>
    </header>
    <nav className="flex flex-col gap-1 p-2" aria-label={navigation.title + ' 导航'}>
      {navigation.items.map(item => {
        const view = views.find(value => value.key === pluginId + '/' + item.viewId)
        const selected = active?.viewId === item.viewId
        return <button key={item.viewId} type="button"
          data-plugin-nav-item={item.viewId} aria-current={selected ? 'page' : undefined}
          disabled={!view}
          className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-hover-bg disabled:opacity-50"
          style={{ color: selected ? 'var(--color-highlight)' : 'var(--color-editor-fg)', backgroundColor: 'transparent' }}
          onClick={() => openLocalPluginView(pluginId + '/' + item.viewId)}
        >
          <LocalPluginIcon icon={view?.icon} />
          <span>{item.title}</span>
        </button>
      })}
    </nav>
  </section>
}
