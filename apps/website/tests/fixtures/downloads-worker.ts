// Local workerd fixture only; never referenced by a deployment configuration.
import { DownloadQuota as ProductionQuota, type QuotaState } from '../../downloads/quota'
import { createGateway } from '../../downloads/gateway'

export class DownloadQuota extends ProductionQuota {
  constructor(private testState: QuotaState) { super(testState) }
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/seed') {
      await this.testState.storage.transaction(async tx => tx.put('counter', {
        day: new Date().toISOString().slice(0, 10), month: new Date().toISOString().slice(0, 7), daily: 19_997, monthly: 499_997,
      }))
      return new Response(null, { status: 204 })
    }
    return super.fetch(request)
  }
}
export default createGateway([{ key: 'hulala/web/1.0.0/test', size: 10, sha256: 'a'.repeat(64), fallback: 'https://github.com/colinagent/hulala/releases/download/web-v1.0.0/test' }])
