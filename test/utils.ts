import fs from 'node:fs'
import path from 'node:path'

function makeTmpPath (prefix: string) {
  const dir = path.join(process.cwd(), 'test', '.tmp')
  fs.mkdirSync(dir, { recursive: true })
  const name = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  return path.join(dir, name)
}

function cleanup (...paths: string[]) {
  for (const p of paths) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
  }
}

function writeFile (filePath: string, data: string | Buffer) {
  fs.writeFileSync(filePath, data)
}

function exists (filePath: string) {
  return fs.existsSync(filePath)
}

export { makeTmpPath, cleanup, writeFile, exists }
