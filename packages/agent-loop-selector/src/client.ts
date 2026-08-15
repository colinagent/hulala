/// <reference types="vite/client" />

const UI_STYLE_ID = 'loopwithai-runtime-ui-style'
const UI_ROOT_ID = 'loopwithai-runtime'
const PROXY_ROOT_ID = 'loopwithai-proxy-settings'
const RUNTIME_CONFIRM_ID = 'loopwithai-runtime-confirm'

document.getElementById(UI_STYLE_ID)?.remove()
document.getElementById(UI_ROOT_ID)?.remove()
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

function dispose(): void {
  observer.disconnect()
  if (authTimer !== undefined) clearTimeout(authTimer)
  root.remove()
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
