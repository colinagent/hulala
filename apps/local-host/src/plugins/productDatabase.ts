import type { Context } from '@deepseek-ai/cordis'
import type { HulalaPaths } from '@hulala/workbench-contracts'
import type { ServerConfig } from '../config.ts'
import { ServerDatabase } from '../database.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    hulalaProductDatabase: ServerDatabase
  }
}

/** Stable private plugin name for Hulala's indexed product data. */
export const name = 'hulala-product-database'

export interface ProductDatabaseConfig {
  paths: HulalaPaths
  retention: NonNullable<ServerConfig['retention']>
}

/** Open the private relational store and own bounded history maintenance. */
export function apply(ctx: Context, config: ProductDatabaseConfig): void {
  const database = new ServerDatabase(config.paths)
  database.prune(config.retention)
  ctx.provide('hulalaProductDatabase', database)
  ctx.effect(() => {
    const timer = setInterval(() => database.prune(config.retention), 6 * 60 * 60_000)
    return () => {
      clearInterval(timer)
      database.close()
    }
  }, 'hulala-product-database: retention and close')
}

/** Private indexed product-store plugin. */
export const productDatabasePlugin = { name, apply }
