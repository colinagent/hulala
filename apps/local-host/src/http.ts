import { ZodError, type ZodType } from 'zod'

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message)
  }
}

export function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  })
}

export async function parseJson<T>(request: Request, schema: ZodType<T>, maxBytes = 1_048_576): Promise<T> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new HttpError(415, 'content_type_invalid', 'content type must be application/json')
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'request_too_large', 'request body is too large')
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  if (reader) try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) { await reader.cancel(); throw new HttpError(413, 'request_too_large', 'request body is too large') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return schema.parse(JSON.parse(raw))
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new HttpError(400, 'request_invalid', 'request body is invalid', error instanceof ZodError ? error.issues : undefined)
    }
    throw error
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ code: error.code, message: error.message, details: error.details }, error.status)
  console.error(error)
  return json({ code: 'internal_error', message: 'internal server error' }, 500)
}
