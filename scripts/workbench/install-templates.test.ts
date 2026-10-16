import { test, expect } from 'bun:test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { posixInstaller } from './install-templates'
import type { ReleaseTarget } from '@hulala/distribution/targets'

const hash = (data: string) => createHash('sha256').update(data).digest('hex')
for (const mode of ['interrupt', 'unavailable', 'corrupt', 'no-range', 'archive-corrupt', 'installer-corrupt'] as const) {
  test.skipIf(process.platform === 'win32')(`POSIX installer handles ${mode} without executing unverified downloads`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'hulala-bootstrap-test-'))
    const marker = join(root, 'invoked')
    const installer = '#!/bin/sh\nprintf "%s\\n" "$@" > "$HULALA_TEST_MARKER"\n'
    const archive = 'verified archive fixture\n'
    const requests: { path: string, range?: string }[] = []
    const server = createServer((request, response) => {
      const path = request.url!, range = request.headers.range
      requests.push({ path, range })
      const data = Buffer.from(path.endsWith('installer') ? installer : archive)
      if (mode === 'installer-corrupt') { response.end('corrupt'); return }
      if (mode === 'archive-corrupt' && path.endsWith('archive')) { response.end('corrupt'); return }
      if (path.startsWith('/primary/')) {
        if (mode === 'unavailable') { response.writeHead(503); response.end(); return }
        if (mode === 'corrupt') { response.end('corrupt'); return }
        // Force curl error 18 after it has received and saved the prefix.
        response.writeHead(200, { 'Content-Length': data.length })
        response.write(data.subarray(0, 10))
        setTimeout(() => response.destroy(), 30)
        return
      }
      if (mode === 'no-range') { response.end(data); return }
      const offset = range ? Number(range.match(/bytes=(\d+)-/)?.[1]) : 0
      response.writeHead(offset ? 206 : 200, { 'Content-Length': data.length - offset, ...(offset ? { 'Content-Range': `bytes ${offset}-${data.length-1}/${data.length}` } : {}) })
      response.end(data.subarray(offset))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`
      const target = `${process.platform}-${process.arch}` as ReleaseTarget
      const script = join(root, 'install.sh')
      await writeFile(script, posixInstaller({ [target]: { installer: base+'/primary/installer', installerFallback: base+'/mirror/installer', archive: base+'/primary/archive', archiveFallback: base+'/mirror/archive', installerSha256: hash(installer), archiveSha256: hash(archive) } }))
      const child = Bun.spawn(['sh', script, '--root', join(root, 'custom directory')], { env: { ...process.env, HOME: root, TMPDIR: root, HULALA_TEST_MARKER: marker }, stdout: 'pipe', stderr: 'pipe' })
      const stderr = new Response(child.stderr).text()
      const code = await child.exited
      if (mode === 'archive-corrupt' || mode === 'installer-corrupt') {
        expect(code).not.toBe(0)
        expect(await Bun.file(marker).exists()).toBe(false)
      } else {
        expect(code).toBe(0)
        const args = (await readFile(marker, 'utf8')).split('\n')
        expect(args.slice(0, 3)).toEqual(['install', '--add-to-path', '--from'])
        expect(args[3]).toEndWith('/package.tar.gz')
        expect(args[4]).toBe('--sha256')
        expect(args[5]).toBe(hash(archive))
        expect(args.slice(6, 8)).toEqual(['--root', join(root, 'custom directory')])
        if (mode === 'interrupt') expect(requests.filter(r => r.path.startsWith('/mirror/')).every(r => r.range === 'bytes=10-')).toBe(true)
      }
      expect((await readdir(root)).some(name => name.startsWith('hulala-install.'))).toBe(false)
      if (mode === 'corrupt' || mode === 'archive-corrupt') expect(await stderr).toContain('SHA-256 mismatch')
      else await stderr
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, {recursive:true,force:true}) }
  }, 20000)
}
