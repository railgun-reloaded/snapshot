import fs from 'node:fs'
import path from 'node:path'

function makeTmpPath (prefix: string) {
  const dir = path.join(process.cwd(), 'test', '.tmp')
  fs.mkdirSync(dir, { recursive: true })
  return fs.mkdtempSync(path.join(dir, `${prefix}-`))
}

function cleanup (...paths: string[]) {
  for (const p of paths) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
  }
}

function writeFile (filePath: string, data: string | Buffer) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, data)
}

function exists (filePath: string) {
  return fs.existsSync(filePath)
}

export { makeTmpPath, cleanup, writeFile, exists }
