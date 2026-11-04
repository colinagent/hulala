// One persistent, transactional counter shared by all download Worker instances.
// Count before touching R2; failures consume a reservation rather than refunding it.
export const DAILY_READ_LIMIT = 20_000
export const MONTHLY_READ_LIMIT = 500_000

export interface Counter { day: string; month: string; daily: number; monthly: number }
interface Transaction {
  get<T>(key: string): Promise<T | undefined>
  put<T>(key: string, value: T): Promise<void>
}
export interface QuotaState { storage: { transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> } }

export function reserve(previous: Counter | undefined, date: Date, dailyLimit = DAILY_READ_LIMIT, monthlyLimit = MONTHLY_READ_LIMIT): Counter | null {
  const day = date.toISOString().slice(0, 10), month = day.slice(0, 7)
  if (previous && (day < previous.day || month < previous.month)) return null
  const daily = previous?.day === day ? previous.daily : 0
  const monthly = previous?.month === month ? previous.monthly : 0
  if (daily >= dailyLimit || monthly >= monthlyLimit) return null
  return { day, month, daily: daily + 1, monthly: monthly + 1 }
}

export class DownloadQuota {
  constructor(private state: QuotaState) {}
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/reserve') return new Response(null, { status: 404 })
    const allowed = await this.state.storage.transaction(async tx => {
      const next = reserve(await tx.get<Counter>('counter'), new Date())
      if (!next) return false
      await tx.put('counter', next)
      return true
    })
    return new Response(null, { status: allowed ? 204 : 429 })
  }
}
