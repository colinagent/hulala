import { installWorkbenchPlatform } from './platform/install'
import { createBrowserPlatform } from './platform/browser'

async function bootstrap(): Promise<void> {
  installWorkbenchPlatform(await createBrowserPlatform())
  await import('./renderer/main')
}

void bootstrap().catch(error => {
  const root = document.getElementById('root')
  if (!root) return
  const title = document.createElement('h1')
  title.textContent = 'Hulala workbench'
  const message = document.createElement('p')
  message.textContent = error instanceof Error ? error.message : 'Could not start the workbench.'
  root.replaceChildren(title, message)
})
