import React, { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openLocalPluginView, pluginAction, startLocalPlugins, useLocalPlugins } from '../../services/localPlugins'
import { SettingsDirtyContext } from '../Settings/settingsDirtyContext'
export function LocalPluginsSettings() {
  const { t } = useTranslation('settings')
  const settings = useContext(SettingsDirtyContext)
  const { plugins, views, commands, errors } = useLocalPlugins()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => startLocalPlugins(), [])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await pluginAction(action) } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const bridge = window.hulala?.localPlugins
  if (!bridge) return null
  return <section className="space-y-4 rounded-lg border border-border p-4">
    <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">{t('localPlugins.title')}</h3>
      <button disabled={busy} className="rounded border border-border px-3 py-2 text-sm" onClick={() => void run(() => bridge.install())}>{t('localPlugins.install')}</button>
    </div>
    <p className="text-sm text-secondary-text">{t('localPlugins.hint')}</p>
    {error && <div role="alert" className="text-sm text-red-500">{error}</div>}
    {!plugins.length && <p className="text-sm text-secondary-text">{t('localPlugins.empty')}</p>}
    {plugins.map(plugin => <div key={plugin.manifest.id} className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3"><strong>{plugin.manifest.name}</strong>
        <span className="text-sm text-secondary-text">{plugin.manifest.version} · {plugin.state}</span>
        <button disabled={busy} className="text-sm underline" onClick={() => void run(() => bridge.enable(plugin.manifest.id, !plugin.enabled))}>{t(plugin.enabled ? 'localPlugins.disable' : 'localPlugins.enable')}</button>
        <button disabled={busy} className="text-sm text-secondary-text underline" onClick={() => void run(() => bridge.uninstall(plugin.manifest.id))}>{t('localPlugins.uninstall')}</button>
      </div>
      <p className="text-sm text-secondary-text">{plugin.manifest.description}</p>
      {(plugin.error || errors[plugin.manifest.id]) && <p role="alert" className="text-sm text-red-500">{plugin.error || errors[plugin.manifest.id]}</p>}
      <div className="flex flex-wrap gap-4 text-sm">
        {views.filter(v => v.pluginId === plugin.manifest.id).map(view => <button key={view.key} className="underline" onClick={() => { if (settings && !settings.requestClose()) return; openLocalPluginView(view.key) }}>{view.title}</button>)}
        {commands.filter(c => c.pluginId === plugin.manifest.id).map(command => <button key={command.key} disabled={busy} className="underline" onClick={() => void run(async () => command.run())}>{command.title}</button>)}
      </div>
    </div>)}
  </section>
}
