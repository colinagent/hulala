import { getDownloadHandleForPhysicalPath } from './resourceService'

export async function downloadWorkspaceFile(path: string, workspaceTabId?: string): Promise<void> {
  const { url, meta } = await getDownloadHandleForPhysicalPath(path, workspaceTabId)
  const link = document.createElement('a')
  link.href = url
  link.download = meta.name || path.split('/').pop() || 'download'
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}
