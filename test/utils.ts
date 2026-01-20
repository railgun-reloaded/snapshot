import fs from 'node:fs'
import path from 'node:path'

/**
 * Create a temporary directory from prefix
 * @param prefix - Prefix to prepend before creating path
 * @returns - Path to created directory
 */
function makeTmpPath (prefix: string) {
  const dir = path.join(process.cwd(), 'test', '.tmp')
  fs.mkdirSync(dir, { recursive: true })
  return fs.mkdtempSync(path.join(dir, `${prefix}-`))
}

/**
 * Cleanup input paths
 * @param paths - Input paths to clean
 */
function cleanup (...paths: string[]) {
  for (const p of paths) {
    try { fs.rmSync(p, { recursive: true, force: true }) } catch {}
  }
}

/**
 * Write data to a file at given filepath
 * @param filePath - Filepath to create file
 * @param data - Content of the file
 */
function writeFile (filePath: string, data: string | Buffer) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, data)
}

/**
 * Check if the given path exists or not
 * @param filePath - Path to check
 * @returns True if it exists else false
 */
function exists (filePath: string) {
  return fs.existsSync(filePath)
}

export { makeTmpPath, cleanup, writeFile, exists }
