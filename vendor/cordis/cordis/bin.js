#!/usr/bin/env node

import { Context } from '@loopwithai/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@loopwithai/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@loopwithai/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
