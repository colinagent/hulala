import React, { useEffect, useRef, useState } from 'react'
import type { Dispose } from '@hulala/plugin-sdk'
import { useLocalPlugins } from '../../services/localPlugins'
export function LocalPluginView({ viewKey }: { viewKey: string }) {
  const view = useLocalPlugins(s => s.views.find(v => v.key === viewKey))
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!view || !container.current) return
    setError('')
    // Each activation owns its DOM root. React never reconciles plugin children.
    const mountPoint = document.createElement('div')
    mountPoint.style.height = '100%'
    container.current.appendChild(mountPoint)
    let dispose: void | Dispose
    try { dispose = view.mount(mountPoint) } catch (reason) { setError(String(reason)) }
    return () => {
      mountPoint.remove()
      // A nested React root must not unmount during the parent's commit.
      void Promise.resolve().then(() => dispose?.()).catch(reason => {
        console.warn('Plugin view cleanup failed', reason)
      })
    }
  }, [view])
  return <div className="h-full min-h-0 overflow-auto">
    {!view && <div className="p-6 text-secondary-text">插件未启用或面板尚未加载。请到设置 → 插件查看状态。</div>}
    {error && <div role="alert" className="p-6 text-red-500">{error}</div>}
    <div ref={container} style={{ height: '100%', display: view && !error ? 'block' : 'none' }} />
  </div>
}
