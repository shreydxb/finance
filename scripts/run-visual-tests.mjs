import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { preview } from 'vite'

const server = await preview({
  logLevel: 'warn',
  preview: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
})

try {
  const cli = resolve('node_modules/@playwright/test/cli.js')
  const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: false,
  })
  const [code] = await once(child, 'close')
  process.exitCode = code ?? 1
} finally {
  await server.close()
}
