import { test, expect } from 'bun:test'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { listenWithFallback } from '../src/instance.js'
import { localFetch } from '../src/health.js'

const close = (server: ReturnType<typeof createServer>) => new Promise<void>(resolve => server.close(() => resolve()))
test('binds another port when the preferred listener is occupied and reports both ports', async () => {
  const occupied = createServer(); await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve))
  const preferred = (occupied.address() as {port:number}).port
  const server = createServer(), notices: string[] = []
  try {
    const port = await listenWithFallback(server, preferred, message => notices.push(message))
    expect(port).not.toBe(preferred)
    expect(notices[0]).toContain(`Port ${preferred} is already in use`)
    expect(notices.at(-1)).toContain(`Using available port ${port}`)
  } finally { await close(server); await close(occupied) }
})
test('permission-denied listeners fall back without suggesting administrator privileges', async () => {
  const server = createServer(), real = server.listen.bind(server)
  let first = true
  server.listen = ((...args: any[]) => {
    if (first) { first = false; queueMicrotask(() => server.emit('error', Object.assign(new Error('denied'), {code:'EACCES'}))); return server }
    return (real as any)(...args)
  }) as typeof server.listen
  const notices: string[] = []
  try { expect(await listenWithFallback(server, 80, m => notices.push(m))).not.toBe(80); expect(notices[0]).toContain('without administrator privileges') }
  finally { await close(server) }
})
test('fallback endpoint is reused by concurrent launches and controlled from a fresh terminal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-port-flow-'))
  const occupied = createServer(socket => socket.destroy()); await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve))
  const port = (occupied.address() as {port:number}).port
  const repo = resolve(import.meta.dir, '../../..')
  const env = {...process.env, HOME:root, HULALA_HOME:join(root,'state'), HULALA_WORKSPACE_ROOT:join(root,'workspaces'), PI_CODING_AGENT_DIR:join(root,'pi'), HULALA_REPOSITORY_ROOT:repo, HULALA_PORT:String(port), HULALA_WORKBENCH_PORT:'0', HULALA_NO_OPEN:'1'}
  const entry = join(repo,'apps/cli/src/main.ts')
  const children: ReturnType<typeof Bun.spawn>[] = []
  const run = (args: string[], environment = env) => {
    const child = Bun.spawn([process.execPath,entry,...args],{cwd:root,env:environment,stdout:'pipe',stderr:'pipe'}); children.push(child)
    const text = Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]).then(parts=>parts.join(''))
    return {child,text}
  }
  const a=run(['__serve']), b=run(['__serve'])
  try {
    const endpointFile=join(root,'state/runtime/launcher/endpoint.json')
    let endpoint:any
    const deadline=Date.now()+35000
    while(Date.now()<deadline){
      endpoint=await readFile(endpointFile,'utf8').then(JSON.parse).catch(()=>null)
      if(endpoint){const r=await localFetch(`http://127.0.0.1:${endpoint.port}/api/hulala/health`).then(r=>r.json()).catch(()=>null) as any;if(r?.workbench?.state==='running')break}
      await Bun.sleep(100)
    }
    expect(endpoint?.port).toBeGreaterThan(0); expect(endpoint.port).not.toBe(port)
    const fresh={...env,HULALA_PORT:'',HULALA_WORKBENCH_PORT:''}
    const reuse=run(['--no-open'],fresh)
    expect(await reuse.child.exited).toBe(0)
    const output=await reuse.text
    expect(output).toContain('Reusing the running Hulala service')
    expect(output).toContain(`hulala.localhost:${endpoint.port}`)
    const state=run(['service','status'],fresh)
    expect(await state.child.exited).toBe(0)
    expect(JSON.parse(await state.text).launcher.pid).toBe(endpoint.pid)
    expect(await Promise.race([a.child.exited,b.child.exited])).toBe(0)
    const shutdown=run(['service','shutdown'],fresh)
    expect(await shutdown.child.exited).toBe(0)
    await Promise.all([a.child.exited,b.child.exited])
    expect(await Bun.file(endpointFile).exists()).toBe(false)
    // Stale port metadata cannot redirect a new service status query.
    await writeFile(endpointFile,JSON.stringify(endpoint))
    const stopped=run(['service','status'],fresh)
    expect(await stopped.child.exited).toBe(1)
    expect(JSON.parse(await stopped.text).launcher.state).toBe('stopped')
  } finally {
    for(const child of children) if(child.exitCode===null)child.kill()
    await Promise.allSettled(children.map(child=>child.exited))
    await Promise.all([a.text,b.text])
    await close(occupied);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100})
  }
},60000)
