/** XHR supplies native upload progress and cancellation without buffering a Blob. */
export function uploadBrowserResource(url: string, data: ArrayBuffer | Blob, contentType: string, options: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    xhr.responseType = 'json'
    xhr.upload.onprogress = event => options.onProgress?.(event.loaded, event.lengthComputable ? event.total : (data instanceof Blob ? data.size : data.byteLength))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response)
      else reject(Object.assign(new Error(xhr.response?.message || 'Upload failed'), { status: xhr.status, code: xhr.response?.code }))
    }
    xhr.onerror = () => reject(new Error('Upload failed. Check the local service and try again.'))
    xhr.onabort = () => reject(new DOMException('Import cancelled', 'AbortError'))
    xhr.onloadend = () => options.signal?.removeEventListener('abort', abort)
    if (options.signal?.aborted) { reject(new DOMException('Import cancelled', 'AbortError')); return }
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.send(data)
  })
}
