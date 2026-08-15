/// <reference types="vite/client" />

const UI_STYLE_ID = 'loopwithai-runtime-ui-style'
const UI_ROOT_ID = 'loopwithai-runtime'
const SERVICE_ROOT_ID = 'loopwithai-service'
const PROXY_ROOT_ID = 'loopwithai-proxy-settings'
const RUNTIME_CONFIRM_ID = 'loopwithai-runtime-confirm'

document.getElementById(UI_STYLE_ID)?.remove()
document.getElementById(UI_ROOT_ID)?.remove()
document.getElementById(SERVICE_ROOT_ID)?.remove()
document.getElementById(PROXY_ROOT_ID)?.remove()
document.getElementById(RUNTIME_CONFIRM_ID)?.remove()
document.querySelectorAll<HTMLElement>('[data-loopwithai-trailing]').forEach(element => delete element.dataset.loopwithaiTrailing)
document.querySelectorAll<HTMLElement>('[data-loopwithai-tools]').forEach(element => delete element.dataset.loopwithaiTools)

const style = document.createElement('style')
style.id = UI_STYLE_ID
style.textContent = `
#loopwithai-runtime{position:relative;z-index:20;display:flex;flex:1 1 570px;align-items:center;gap:5px;width:570px;max-width:100%;min-width:0;color:inherit;font:12px system-ui}
#loopwithai-runtime:not([data-mounted]),#loopwithai-runtime [hidden]{display:none!important}
#loopwithai-runtime select,#loopwithai-runtime input,#loopwithai-runtime button{box-sizing:border-box;height:30px;max-width:240px;min-width:0;background:transparent;color:inherit;border:0;border-radius:7px;padding:4px 7px;font:inherit}
#loopwithai-runtime select{border:1px solid color-mix(in srgb,currentColor 16%,transparent);background:Canvas}
#loopwithai-runtime button{cursor:pointer}
#loopwithai-runtime button:hover{background:color-mix(in srgb,currentColor 7%,transparent)}
#loopwithai-runtime [data-runtime]{flex:0 2 110px;width:110px;min-width:72px}
#loopwithai-runtime [data-model]{flex:1 4 250px;width:250px;max-width:290px;min-width:120px}
#loopwithai-runtime [data-thinking]{flex:0 3 130px;width:130px;max-width:130px;min-width:82px}
#loopwithai-runtime [data-accounts-toggle]{flex:0 0 auto;padding-inline:5px}
[data-loopwithai-tools]{flex-shrink:0!important}
[data-loopwithai-trailing]{flex:1 1 auto!important;min-width:0!important}
#loopwithai-runtime .err{position:absolute;right:0;bottom:calc(100% + 8px);color:#d33;background:Canvas;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px;padding:7px;max-width:420px;box-shadow:0 8px 28px #0002}
#loopwithai-runtime .panel{position:absolute;right:0;bottom:calc(100% + 8px);z-index:2147483647;width:min(520px,calc(100vw - 32px));padding:10px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;background:Canvas;color:CanvasText;box-shadow:0 10px 32px #0003}
#loopwithai-runtime .accounts{display:grid;gap:7px}
#loopwithai-runtime .account{display:flex;align-items:center;gap:7px;justify-content:space-between}
#loopwithai-runtime .flow{display:grid;gap:5px;padding:6px;border-radius:6px;background:color-mix(in srgb,currentColor 6%,transparent)}
#loopwithai-runtime a{color:LinkText}
[data-loopwithai-service]{position:fixed;z-index:2147483600;top:12px;left:12px;color:CanvasText;font:13px system-ui}
[data-loopwithai-service] [hidden]{display:none!important}
[data-loopwithai-service] button,[data-loopwithai-service] a{box-sizing:border-box;border:0;border-radius:9px;background:transparent;color:inherit;padding:7px 10px;font:inherit;text-decoration:none;cursor:pointer}
[data-loopwithai-service] button:hover,[data-loopwithai-service] a:hover{background:color-mix(in srgb,CanvasText 7%,transparent)}
[data-loopwithai-service] .environment{display:flex;align-items:center;gap:5px;padding:4px;border:1px solid color-mix(in srgb,CanvasText 15%,transparent);border-radius:12px;background:Canvas;box-shadow:0 7px 28px #0002}
[data-loopwithai-service] .environment>[aria-current="page"]{background:#246bfd;color:white}
[data-loopwithai-service] .status-dot{display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;background:#d49b00}
[data-loopwithai-service] .status-dot.running{background:#24a35a}
[data-loopwithai-service] .status-dot.crashed{background:#d33}
[data-loopwithai-service] .service-panel{position:absolute;top:calc(100% + 8px);left:0;width:min(340px,calc(100vw - 24px));padding:16px;border:1px solid color-mix(in srgb,CanvasText 15%,transparent);border-radius:14px;background:Canvas;box-shadow:0 12px 38px #0003}
[data-loopwithai-service] .service-title{font-weight:650;margin-bottom:4px}
[data-loopwithai-service] .service-detail{color:color-mix(in srgb,CanvasText 62%,transparent);font:12px/1.6 ui-monospace,SFMono-Regular,monospace}
[data-loopwithai-service] .service-actions{display:flex;gap:7px;margin-top:13px}
[data-loopwithai-service] .service-actions button{border:1px solid color-mix(in srgb,CanvasText 16%,transparent)}
[data-loopwithai-service] .service-actions button:disabled{opacity:.55;cursor:wait}
[data-loopwithai-service] .autostart-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:13px;padding-top:13px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent)}
[data-loopwithai-service] .autostart-row input{width:18px;height:18px}
[data-loopwithai-service] .autostart-reminder{position:absolute;top:calc(100% + 8px);left:0;width:min(380px,calc(100vw - 24px));padding:14px;border:1px solid color-mix(in srgb,CanvasText 15%,transparent);border-radius:14px;background:Canvas;box-shadow:0 12px 38px #0003}
[data-loopwithai-service] .autostart-reminder p{margin:0 0 10px;color:color-mix(in srgb,CanvasText 66%,transparent);line-height:1.45}
[data-loopwithai-service] .autostart-reminder div{display:flex;gap:7px}
[data-loopwithai-service] .autostart-reminder [data-autostart-enable]{background:#246bfd;color:#fff}
[data-loopwithai-busy="true"]{cursor:progress}
#loopwithai-runtime-confirm{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:color-mix(in srgb,#000 32%,transparent);font:14px system-ui}
#loopwithai-runtime-confirm[hidden]{display:none!important}
#loopwithai-runtime-confirm .confirm-card{box-sizing:border-box;width:min(440px,100%);padding:20px;border:1px solid color-mix(in srgb,CanvasText 16%,transparent);border-radius:16px;background:Canvas;color:CanvasText;box-shadow:0 20px 64px #0004}
#loopwithai-runtime-confirm h2{margin:0 0 8px;font-size:17px;line-height:24px}
#loopwithai-runtime-confirm p{margin:0;color:color-mix(in srgb,CanvasText 68%,transparent);line-height:21px}
#loopwithai-runtime-confirm .confirm-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
#loopwithai-runtime-confirm button{min-height:36px;padding:7px 13px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:9px;background:transparent;color:inherit;font:inherit;cursor:pointer}
#loopwithai-runtime-confirm button:hover{background:color-mix(in srgb,CanvasText 7%,transparent)}
#loopwithai-runtime-confirm [data-runtime-confirm]{border-color:#3377ff;background:#3377ff;color:white}
#loopwithai-runtime-confirm [data-runtime-confirm]:hover{background:#2868e8}
[data-slot="conversation.input.model"][data-loopwithai-hidden="true"]>*{display:none!important}
#loopwithai-proxy-settings{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;padding:16px 0;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:14px system-ui}
#loopwithai-proxy-settings[hidden],#loopwithai-proxy-settings [hidden]{display:none!important}
#loopwithai-proxy-settings .proxy-title{font-weight:500}
#loopwithai-proxy-settings .proxy-description,#loopwithai-proxy-settings .proxy-state{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
#loopwithai-proxy-settings .proxy-controls,#loopwithai-proxy-settings .proxy-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#loopwithai-proxy-settings select,#loopwithai-proxy-settings input,#loopwithai-proxy-settings button{box-sizing:border-box;height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:transparent;color:inherit;padding:0 11px;font:inherit}
#loopwithai-proxy-settings select{background:var(--dsw-alias-bg-layer-2)}
#loopwithai-proxy-settings input{flex:1;min-width:260px;background:var(--dsw-alias-bg-layer-1)}
#loopwithai-proxy-settings button{cursor:pointer}
#loopwithai-proxy-settings button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
#loopwithai-proxy-settings button:disabled{opacity:.55;cursor:default}
#loopwithai-proxy-settings .proxy-error{color:var(--dsw-alias-state-error-primary);font-size:13px}
#loopwithai-proxy-settings .proxy-result{color:var(--dsw-alias-state-success-primary);font-size:13px}
`
document.head.append(style)

document.body.insertAdjacentHTML('beforeend', `
<aside id="loopwithai-service" data-loopwithai-service>
  <div class="environment"><button data-local-toggle aria-current="page" aria-expanded="false"><i class="status-dot" data-service-dot></i>Local</button><a href="https://loopwith.ai/" target="_blank" rel="noreferrer">Cloud ↗</a></div>
  <section class="service-panel" data-service-panel hidden>
    <div class="service-title" data-service-status>Connecting to local service…</div>
    <div class="service-detail" data-service-detail></div>
    <div class="service-actions"><button data-service-restart>Restart</button><button data-service-stop>Stop workbench</button><button data-service-update hidden>Update</button></div>
    <label class="autostart-row"><span>Start after login</span><input data-autostart-toggle type="checkbox"></label>
  </section>
  <section class="autostart-reminder" data-autostart-reminder hidden><p>Keep Local available after you sign in. This installs a current-user startup item and never asks for administrator access.</p><div><button data-autostart-enable>Enable</button><button data-autostart-dismiss>Not now</button></div></section>
</aside>
<div id="loopwithai-runtime">
  <select data-runtime aria-label="Agent runtime"></select>
  <select data-model aria-label="Agent model" hidden></select>
  <select data-thinking aria-label="Thinking level" hidden></select>
  <input data-model-id aria-label="Agent model ID" hidden placeholder="Model ID">
  <button data-accounts-toggle hidden>Accounts</button>
  <span class="err" hidden></span>
  <div class="accounts panel" data-accounts hidden></div>
</div>
<section id="loopwithai-proxy-settings" hidden>
  <div><div class="proxy-title">Proxy</div><div class="proxy-description">Global network settings for Pi, DeepSeek, Codex, Claude Code, and other Harness requests.</div></div>
  <div class="proxy-controls">
    <select data-proxy-mode aria-label="Proxy mode"><option value="auto">Auto · system/environment</option><option value="manual">Manual proxy</option><option value="off">Off · direct</option></select>
    <input data-proxy-url type="password" autocomplete="off" aria-label="Proxy URL" placeholder="http://127.0.0.1:7897" hidden>
  </div>
  <div class="proxy-state" data-proxy-state>Loading current network configuration…</div>
  <div class="proxy-actions"><button data-proxy-save>Save</button><button data-proxy-test>Test connection</button><span class="proxy-result" data-proxy-result role="status"></span><span class="proxy-error" data-proxy-error role="alert" hidden></span></div>
</section>
<div id="loopwithai-runtime-confirm" role="dialog" aria-modal="true" aria-labelledby="loopwithai-runtime-confirm-title" hidden>
  <div class="confirm-card">
    <h2 id="loopwithai-runtime-confirm-title">Start a new session to switch agents?</h2>
    <p data-runtime-confirm-message></p>
    <div class="confirm-actions"><button data-runtime-cancel>Cancel</button><button data-runtime-confirm>New session &amp; switch</button></div>
  </div>
</div>`)

function required<T extends Element>(selector: string, parent: ParentNode = document): T {
  const value = parent.querySelector<T>(selector)
  if (value === null) throw new Error(`LoopWithAI UI element is missing: ${selector}`)
  return value
}

const root = required<HTMLDivElement>(`#${UI_ROOT_ID}`)
const serviceRoot = required<HTMLElement>(`#${SERVICE_ROOT_ID}`)
const localToggle = required<HTMLButtonElement>('[data-local-toggle]', serviceRoot)
const servicePanel = required<HTMLElement>('[data-service-panel]', serviceRoot)
const serviceDot = required<HTMLElement>('[data-service-dot]', serviceRoot)
const serviceStatus = required<HTMLElement>('[data-service-status]', serviceRoot)
const serviceDetail = required<HTMLElement>('[data-service-detail]', serviceRoot)
const serviceRestart = required<HTMLButtonElement>('[data-service-restart]', serviceRoot)
const serviceStop = required<HTMLButtonElement>('[data-service-stop]', serviceRoot)
const serviceUpdate = required<HTMLButtonElement>('[data-service-update]', serviceRoot)
const autostartToggle = required<HTMLInputElement>('[data-autostart-toggle]', serviceRoot)
const autostartReminder = required<HTMLElement>('[data-autostart-reminder]', serviceRoot)
const autostartEnable = required<HTMLButtonElement>('[data-autostart-enable]', serviceRoot)
const autostartDismiss = required<HTMLButtonElement>('[data-autostart-dismiss]', serviceRoot)
const runtimeSelect = required<HTMLSelectElement>('[data-runtime]', root)
const modelSelect = required<HTMLSelectElement>('[data-model]', root)
const thinkingSelect = required<HTMLSelectElement>('[data-thinking]', root)
const modelInput = required<HTMLInputElement>('[data-model-id]', root)
const errorBox = required<HTMLSpanElement>('.err', root)
const accountsToggle = required<HTMLButtonElement>('[data-accounts-toggle]', root)
const accounts = required<HTMLDivElement>('[data-accounts]', root)
const proxyRoot = required<HTMLElement>(`#${PROXY_ROOT_ID}`)
const proxyMode = required<HTMLSelectElement>('[data-proxy-mode]', proxyRoot)
const proxyUrl = required<HTMLInputElement>('[data-proxy-url]', proxyRoot)
const proxySave = required<HTMLButtonElement>('[data-proxy-save]', proxyRoot)
const proxyTest = required<HTMLButtonElement>('[data-proxy-test]', proxyRoot)
const proxyState = required<HTMLDivElement>('[data-proxy-state]', proxyRoot)
const proxyResult = required<HTMLSpanElement>('[data-proxy-result]', proxyRoot)
const proxyError = required<HTMLSpanElement>('[data-proxy-error]', proxyRoot)
const runtimeConfirm = required<HTMLDivElement>(`#${RUNTIME_CONFIRM_ID}`)
const runtimeConfirmMessage = required<HTMLParagraphElement>('[data-runtime-confirm-message]', runtimeConfirm)
const runtimeConfirmButton = required<HTMLButtonElement>('[data-runtime-confirm]', runtimeConfirm)
const runtimeCancelButton = required<HTMLButtonElement>('[data-runtime-cancel]', runtimeConfirm)

let authTimer: ReturnType<typeof setTimeout> | undefined
let serviceTimer: ReturnType<typeof setTimeout> | undefined
let serviceToken = ''
let proxyRevision = 0
let currentRuntime = 'pi'
let pendingRuntime: string | undefined
let availableModels: any[] = []

function showProxyError(error: unknown): void {
  proxyError.textContent = error instanceof Error ? error.message : String(error)
  proxyError.hidden = false
}

function mount(): void {
  const right = document.querySelector('[data-slot="conversation.input.right"]')
  const nativeModel = document.querySelector<HTMLElement>('[data-slot="conversation.input.model"]')
  if (right !== null && root.parentElement !== right) right.append(root)
  root.toggleAttribute('data-mounted', right !== null)
  const trailing = right?.parentElement
  const row = trailing?.parentElement
  const tools = row === undefined || row === null ? undefined : [...row.children].find(element => element !== trailing)
  document.querySelectorAll<HTMLElement>('[data-loopwithai-trailing]').forEach(element => {
    if (element !== trailing) delete element.dataset.loopwithaiTrailing
  })
  document.querySelectorAll<HTMLElement>('[data-loopwithai-tools]').forEach(element => {
    if (element !== tools) delete element.dataset.loopwithaiTools
  })
  if (trailing instanceof HTMLElement) trailing.dataset.loopwithaiTrailing = 'true'
  if (tools instanceof HTMLElement) tools.dataset.loopwithaiTools = 'true'
  if (nativeModel !== null) nativeModel.dataset.loopwithaiHidden = String(currentRuntime !== 'deepseek')

  const dialog = document.querySelector('[role="dialog"]')
  const nav = dialog?.querySelector('nav')
  const buttons = nav?.querySelectorAll('button')
  const generalActive = buttons?.[0]?.getAttribute('aria-current') === 'true'
  const options = nav?.nextElementSibling?.lastElementChild
  const page = options?.firstElementChild
  if (generalActive && page !== null && page !== undefined) {
    const moved = proxyRoot.parentElement !== page
    if (moved) page.append(proxyRoot)
    proxyRoot.hidden = false
    if (moved) void loadProxy().catch(showProxyError)
  } else {
    proxyRoot.hidden = true
  }
}

const observer = new MutationObserver(mount)
observer.observe(document.body, { childList: true, subtree: true })
mount()

const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character)

async function jsonRequest(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, init)
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`)
  return value
}

function uptimeLabel(value: number | undefined): string {
  if (typeof value !== 'number') return '—'
  const seconds = Math.max(0, Math.floor(value / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds % 60}s`
}

function renderService(value: any): void {
  serviceToken = value.actionToken ?? ''
  const workbench = value.workbench ?? {}
  const label: Record<string, string> = {
    running: 'Local workbench is running', starting: 'Starting local workbench…', stopping: 'Stopping local workbench…',
    restarting: 'Restarting local workbench…', stopped: 'Local workbench is stopped', crashed: 'Local workbench needs attention',
  }
  serviceStatus.textContent = label[workbench.state] ?? 'Connecting to local service…'
  serviceDetail.textContent = `Workbench ${workbench.pid ? `PID ${workbench.pid} · ` : ''}v${workbench.version ?? value.launcher?.version ?? '—'} · Up ${uptimeLabel(workbench.uptimeMs)}\nLauncher PID ${value.launcher?.pid ?? '—'}`
  serviceDot.className = `status-dot ${workbench.state ?? ''}`
  serviceStop.disabled = workbench.state !== 'running'
  serviceRestart.disabled = workbench.state === 'starting' || workbench.state === 'stopping' || workbench.state === 'restarting'
  autostartToggle.checked = value.autostart?.installed === true
  autostartToggle.disabled = value.autostart?.supported !== true
  autostartReminder.hidden = value.autostart?.installed === true || localStorage.getItem('loopwithai.autostart-reminder-dismissed') === '1'
  serviceUpdate.hidden = value.update?.available !== true || value.autostart?.installed !== true
  serviceUpdate.textContent = value.update?.latestVersion ? `Update to v${value.update.latestVersion}` : 'Update'
}

async function loadService(): Promise<void> {
  try {
    renderService(await jsonRequest('/api/loopwithai/service', { cache: 'no-store' }))
  } catch {
    serviceStatus.textContent = 'Local launcher connection interrupted'
    serviceDetail.textContent = 'Run npx loopwithai in a terminal to recover.'
    serviceDot.className = 'status-dot crashed'
  } finally {
    serviceTimer = setTimeout(() => { void loadService() }, 2_000)
  }
}

async function serviceAction(action: 'stop' | 'restart' | 'autostart-install' | 'autostart-uninstall' | 'update'): Promise<void> {
  serviceRestart.disabled = serviceStop.disabled = serviceUpdate.disabled = autostartToggle.disabled = true
  try {
    const value = await jsonRequest('/api/loopwithai/service', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-loopwithai-token': serviceToken },
      body: JSON.stringify({ action }),
    })
    if (action === 'stop' || action === 'restart') location.reload()
    else if (action === 'update') {
      serviceStatus.textContent = 'Update installed. Restarting Local…'
      setTimeout(() => location.reload(), 1_500)
    }
    else renderService(value)
  } catch (error) {
    serviceStatus.textContent = error instanceof Error ? error.message : String(error)
    serviceRestart.disabled = serviceStop.disabled = false
    serviceUpdate.disabled = false
    autostartToggle.checked = action === 'autostart-uninstall'
    autostartToggle.disabled = false
  }
}

async function post(body: Record<string, unknown>, reload = false): Promise<boolean> {
  errorBox.hidden = true
  errorBox.textContent = ''
  try {
    await jsonRequest(body.action ? '/api/loopwithai/pi' : '/api/loopwithai/runtimes', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (reload) location.reload()
    else await load()
    return true
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
    await load()
    return false
  }
}

function hasConversationHistory(): boolean {
  return document.querySelector('[data-chat-flow-kind="user"], [data-chat-flow-kind="assistant-step"]') !== null
}

function isBlankSessionReady(): boolean {
  return document.querySelector('[data-slot="conversation.hero.workspace"]') !== null
    && document.querySelector('[data-chat-flow-kind="user"], [data-chat-flow-kind="assistant-step"]') === null
    && document.querySelector('[data-slot="conversation.input.right"]') !== null
}

function runtimeLabel(runtime: string): string {
  return runtimeSelect.querySelector<HTMLOptionElement>(`option[value="${CSS.escape(runtime)}"]`)?.textContent?.trim() || runtime
}

function setRuntimeBusy(busy: boolean): void {
  document.body.dataset.loopwithaiBusy = String(busy)
  runtimeSelect.disabled = busy
  modelSelect.disabled = busy
  thinkingSelect.disabled = busy
  modelInput.disabled = busy
  accountsToggle.disabled = busy
}

function closeRuntimeConfirm(): void {
  pendingRuntime = undefined
  runtimeConfirm.hidden = true
  runtimeSelect.value = currentRuntime
  runtimeSelect.focus()
}

function openRuntimeConfirm(runtime: string): void {
  pendingRuntime = runtime
  runtimeSelect.value = currentRuntime
  runtimeConfirmMessage.textContent = `Your current conversation stays in history. To use ${runtimeLabel(runtime)}, LoopWithAI will open a new session in the same workspace.`
  runtimeConfirm.hidden = false
  runtimeCancelButton.focus()
}

function waitForBlankSession(timeoutMs = 30_000): Promise<void> {
  if (isBlankSessionReady()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect()
      reject(new Error('The new session did not become ready. Please try again.'))
    }, timeoutMs)
    const observer = new MutationObserver(() => {
      if (!isBlankSessionReady()) return
      clearTimeout(timeout)
      observer.disconnect()
      resolve()
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
}

async function newSessionAndSwitch(runtime: string): Promise<void> {
  setRuntimeBusy(true)
  runtimeConfirm.hidden = true
  try {
    const newSession = document.querySelector<HTMLButtonElement>('button[aria-label="New session"]')
    if (newSession === null) throw new Error('Harness New session action is unavailable.')
    newSession.click()
    await waitForBlankSession()
    const switched = await post({ runtime }, true)
    if (!switched) setRuntimeBusy(false)
  } catch (error) {
    errorBox.textContent = error instanceof Error ? error.message : String(error)
    errorBox.hidden = false
    pendingRuntime = undefined
    runtimeSelect.value = currentRuntime
    setRuntimeBusy(false)
  }
}

function renderAuth(auth: any): void {
  accountsToggle.hidden = !auth
  accounts.innerHTML = ''
  if (!auth) return
  const flows = auth.flows ?? []
  accounts.innerHTML = auth.providers.map((provider: any) => {
    const flow = flows.find((item: any) => item.provider === provider.id && item.status === 'running')
      ?? flows.findLast?.((item: any) => item.provider === provider.id)
    let detail = ''
    if (flow) {
      const event = flow.event ?? {}
      if (event.type === 'auth_url') detail += `<a target="_blank" rel="noreferrer" href="${escapeHtml(event.url)}">Open authorization page</a>${event.instructions ? `<span>${escapeHtml(event.instructions)}</span>` : ''}`
      if (event.type === 'device_code') detail += `<a target="_blank" rel="noreferrer" href="${escapeHtml(event.verificationUri)}">Open device login</a><strong>${escapeHtml(event.userCode)}</strong>`
      if (event.type === 'info' || event.type === 'progress') detail += `<span>${escapeHtml(event.message)}</span>`
      if (flow.prompt) {
        if (flow.prompt.type === 'select') detail += `<select data-flow-select="${escapeHtml(flow.id)}">${flow.prompt.options.map((option: any) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.label)}</option>`).join('')}</select><button data-flow-submit="${escapeHtml(flow.id)}">Continue</button>`
        else detail += `<input data-flow-input="${escapeHtml(flow.id)}" type="${flow.prompt.type === 'secret' ? 'password' : 'text'}" placeholder="${escapeHtml(flow.prompt.placeholder ?? flow.prompt.message)}"><button data-flow-submit="${escapeHtml(flow.id)}">Continue</button>`
      }
      if (flow.error) detail += `<span class="err">${escapeHtml(flow.error)}</span>`
      if (flow.status === 'running') detail += `<button data-flow-cancel="${escapeHtml(flow.id)}">Cancel</button>`
    }
    const status = provider.authenticated ? (provider.source ?? provider.authType ?? 'Signed in') : provider.oauthName
    return `<div class="account"><span><strong>${escapeHtml(provider.name)}</strong><br><small>${escapeHtml(status)}</small></span><button data-auth-action="${provider.usingOAuth ? 'logout' : 'login'}" data-provider="${escapeHtml(provider.id)}">${provider.usingOAuth ? 'Sign out' : 'Sign in'}</button></div>${detail ? `<div class="flow">${detail}</div>` : ''}`
  }).join('')
  accounts.querySelectorAll<HTMLButtonElement>('[data-auth-action]').forEach(button => {
    button.onclick = () => { void post({ action: button.dataset.authAction, provider: button.dataset.provider }) }
  })
  accounts.querySelectorAll<HTMLButtonElement>('[data-flow-submit]').forEach(button => {
    button.onclick = () => {
      const id = button.dataset.flowSubmit
      const input = accounts.querySelector<HTMLInputElement>(`[data-flow-input="${id}"]`)
      const select = accounts.querySelector<HTMLSelectElement>(`[data-flow-select="${id}"]`)
      void post({ action: 'auth-input', flowId: id, value: (input ?? select)?.value })
    }
  })
  accounts.querySelectorAll<HTMLButtonElement>('[data-flow-cancel]').forEach(button => {
    button.onclick = () => { void post({ action: 'auth-cancel', flowId: button.dataset.flowCancel }) }
  })
  if (authTimer !== undefined) clearTimeout(authTimer)
  if (flows.some((flow: any) => flow.status === 'running')) authTimer = setTimeout(() => { void load() }, 750)
}

function modelKey(model: any): string {
  return `${model.provider}/${model.id}`
}

function selectedModel(): any | undefined {
  return availableModels.find(model => modelKey(model) === modelSelect.value)
}

function thinkingLabel(level: string): string {
  const labels: Record<string, string> = {
    off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max', ultra: 'Ultra',
  }
  return labels[level] ?? level.replace(/(^|[-_])([a-z])/g, (_match, _separator, letter: string) => letter.toUpperCase())
}

function defaultThinkingLevel(model: any, preferred?: string): string | undefined {
  const levels = Array.isArray(model?.thinkingLevels) ? model.thinkingLevels.filter((level: unknown): level is string => typeof level === 'string') : []
  if (preferred !== undefined && levels.includes(preferred)) return preferred
  if (typeof model?.defaultThinkingLevel === 'string' && levels.includes(model.defaultThinkingLevel)) return model.defaultThinkingLevel
  if (levels.includes('medium')) return 'medium'
  return levels[0]
}

function renderThinking(model: any, preferred?: string): void {
  const levels = Array.isArray(model?.thinkingLevels) ? model.thinkingLevels.filter((level: unknown): level is string => typeof level === 'string') : []
  if (levels.length <= 1) {
    thinkingSelect.hidden = true
    thinkingSelect.innerHTML = ''
    return
  }
  thinkingSelect.innerHTML = levels.map((level: string) => `<option value="${escapeHtml(level)}">Thinking · ${escapeHtml(thinkingLabel(level))}</option>`).join('')
  thinkingSelect.value = defaultThinkingLevel(model, preferred) ?? levels[0]
  thinkingSelect.hidden = false
}

function renderProxy(value: any): void {
  proxyRevision = value.revision
  proxyMode.value = value.mode
  proxyUrl.hidden = value.mode !== 'manual'
  proxyUrl.placeholder = value.manualConfigured ? 'Configured · enter the complete URL to replace it' : 'http://127.0.0.1:7897'
  const endpoints = [value.httpProxy && `HTTP ${value.httpProxy}`, value.httpsProxy && `HTTPS ${value.httpsProxy}`].filter(Boolean).join(' · ')
  const source = value.source === 'macos-system' ? 'macOS system proxy'
    : value.source === 'environment' ? 'Terminal environment'
      : value.source === 'loopwithai' ? 'LOOPWITHAI_PROXY'
        : value.source === 'manual' ? 'Manual proxy' : 'Direct connection'
  proxyState.textContent = `${source} · ${endpoints || 'direct'}${value.warning ? ` · ${value.warning}` : ''}`
}

async function loadProxy(): Promise<void> {
  renderProxy(await jsonRequest('/api/loopwithai/proxy', { cache: 'no-store' }))
}

async function proxyPost(body: Record<string, unknown>): Promise<void> {
  proxyError.hidden = true
  proxyError.textContent = ''
  proxyResult.textContent = ''
  proxySave.disabled = proxyTest.disabled = true
  try {
    const value = await jsonRequest('/api/loopwithai/proxy', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (body.action === 'test') proxyResult.textContent = `Connected · HTTP ${value.status} · ${value.durationMs} ms`
    else {
      proxyUrl.value = ''
      renderProxy(value)
      proxyResult.textContent = 'Saved. New requests use this setting.'
    }
  } catch (error) {
    showProxyError(error)
  } finally {
    proxySave.disabled = proxyTest.disabled = false
  }
}

async function load(): Promise<void> {
  const state = await jsonRequest('/api/loopwithai/runtimes', { cache: 'no-store' })
  if (state.current === 'pi') {
    const pi = await jsonRequest('/api/loopwithai/pi', { cache: 'no-store' })
    state.models = pi.models ?? []
    state.auth = pi.auth
    if (state.models.length) state.modelError = ''
  }
  currentRuntime = state.current
  availableModels = state.models
  mount()
  runtimeSelect.innerHTML = state.runtimes.map((runtime: any) => `<option value="${escapeHtml(runtime.id)}">${escapeHtml(runtime.name)}</option>`).join('')
  runtimeSelect.value = state.current
  errorBox.textContent = state.modelError ?? ''
  errorBox.hidden = !state.modelError
  if (state.models.length) {
    modelSelect.hidden = false
    modelInput.hidden = true
    modelSelect.innerHTML = state.models.map((model: any) => `<option value="${escapeHtml(modelKey(model))}">${escapeHtml(`${model.name} · ${model.providerName ?? model.provider}`)}</option>`).join('')
    const requestedKey = state.selection?.provider && state.selection?.model ? `${state.selection.provider}/${state.selection.model}` : undefined
    const initialModel = state.models.find((model: any) => modelKey(model) === requestedKey)
      ?? state.models.find((model: any) => model.default)
      ?? state.models[0]
    modelSelect.value = modelKey(initialModel)
    renderThinking(initialModel, state.selection?.thinkingLevel)
  } else {
    modelSelect.hidden = true
    thinkingSelect.hidden = true
    thinkingSelect.innerHTML = ''
    modelInput.hidden = state.current === 'deepseek'
    modelInput.value = state.selection?.model ?? ''
  }
  renderAuth(state.auth)
}

accountsToggle.onclick = () => { accounts.hidden = !accounts.hidden }
localToggle.onclick = () => {
  servicePanel.hidden = !servicePanel.hidden
  localToggle.setAttribute('aria-expanded', String(!servicePanel.hidden))
}
serviceRestart.onclick = () => { void serviceAction('restart') }
serviceStop.onclick = () => { void serviceAction('stop') }
serviceUpdate.onclick = () => {
  if (confirm(`Update LoopWithAI to ${serviceUpdate.textContent?.replace('Update to ', '') ?? 'the latest version'} and restart Local?`)) void serviceAction('update')
}
autostartToggle.onchange = () => { void serviceAction(autostartToggle.checked ? 'autostart-install' : 'autostart-uninstall') }
autostartEnable.onclick = () => { autostartReminder.hidden = true; autostartToggle.checked = true; void serviceAction('autostart-install') }
autostartDismiss.onclick = () => { localStorage.setItem('loopwithai.autostart-reminder-dismissed', '1'); autostartReminder.hidden = true }
proxyMode.onchange = () => { proxyUrl.hidden = proxyMode.value !== 'manual' }
proxySave.onclick = () => { void proxyPost({ action: 'update', mode: proxyMode.value, proxyUrl: proxyUrl.value || undefined, expectedRevision: proxyRevision }) }
proxyTest.onclick = () => { void proxyPost({ action: 'test' }) }
runtimeSelect.onchange = () => {
  const target = runtimeSelect.value
  if (target === currentRuntime) return
  if (hasConversationHistory()) openRuntimeConfirm(target)
  else {
    setRuntimeBusy(true)
    void post({ runtime: target }, true).then(switched => { if (!switched) setRuntimeBusy(false) })
  }
}
runtimeCancelButton.onclick = closeRuntimeConfirm
runtimeConfirmButton.onclick = () => {
  const target = pendingRuntime
  if (target !== undefined) void newSessionAndSwitch(target)
}
runtimeConfirm.onclick = event => { if (event.target === runtimeConfirm) closeRuntimeConfirm() }
runtimeConfirm.onkeydown = event => { if (event.key === 'Escape') closeRuntimeConfirm() }
modelSelect.onchange = () => {
  const model = selectedModel()
  if (model === undefined) return
  const thinkingLevel = defaultThinkingLevel(model)
  renderThinking(model, thinkingLevel)
  void post({ runtime: runtimeSelect.value, provider: model.provider, model: model.id, thinkingLevel }, true)
}
thinkingSelect.onchange = () => {
  const model = selectedModel()
  if (model === undefined) return
  void post({ runtime: runtimeSelect.value, provider: model.provider, model: model.id, thinkingLevel: thinkingSelect.value }, true)
}
modelInput.onchange = () => { void post({ runtime: runtimeSelect.value, model: modelInput.value || undefined }, true) }

void load().catch(error => {
  errorBox.textContent = error instanceof Error ? error.message : String(error)
  errorBox.hidden = false
})
void loadService()

function dispose(): void {
  observer.disconnect()
  if (authTimer !== undefined) clearTimeout(authTimer)
  if (serviceTimer !== undefined) clearTimeout(serviceTimer)
  root.remove()
  serviceRoot.remove()
  proxyRoot.remove()
  runtimeConfirm.remove()
  delete document.body.dataset.loopwithaiBusy
  document.querySelectorAll<HTMLElement>('[data-loopwithai-trailing]').forEach(element => delete element.dataset.loopwithaiTrailing)
  document.querySelectorAll<HTMLElement>('[data-loopwithai-tools]').forEach(element => delete element.dataset.loopwithaiTools)
  style.remove()
  const nativeModel = document.querySelector<HTMLElement>('[data-slot="conversation.input.model"]')
  if (nativeModel !== null) delete nativeModel.dataset.loopwithaiHidden
}

if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose(dispose)
}
