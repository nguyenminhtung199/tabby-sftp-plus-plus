import { execFile } from 'child_process'
import * as os from 'os'

import { log } from '../../services/sftp-logger'

function getElectronShell(): { trashItem?: (fullPath: string) => Promise<void> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    if (electron?.shell?.trashItem) return electron.shell
  } catch { /* ignore */ }
  return null
}

export async function trashLocalPath(fullPath: string, isDirectory: boolean): Promise<void> {
  const target = String(fullPath).replace(/\0/g, '')
  if (!target) throw new Error('empty path')

  const shell = getElectronShell()
  if (shell?.trashItem) {
    try {
      await shell.trashItem(target)
      return
    } catch (err) {
      log.warn('shell.trashItem failed, trying Windows fallback:', target, err)
    }
  }

  if (os.platform() !== 'win32') {
    throw new Error('trash API unavailable')
  }

  await trashViaPowerShellEnv(target, isDirectory)
}

function trashViaPowerShellEnv(fullPath: string, isDirectory: boolean): Promise<void> {
  const method = isDirectory ? 'DeleteDirectory' : 'DeleteFile'

  const command =
    `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
    `$p = $env:SFTP_PLUS_TRASH_PATH; ` +
    `if (-not $p) { throw 'SFTP_PLUS_TRASH_PATH missing' }; ` +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::${method}(` +
    `$p,` +
    `[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,` +
    `[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`

  return new Promise<void>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command],
      {
        timeout: isDirectory ? 30000 : 15000,
        windowsHide: true,
        env: {
          ...process.env,
          SFTP_PLUS_TRASH_PATH: fullPath,
        },
      },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.toString?.() || err.message || String(err)))
          return
        }
        resolve()
      },
    )
  })
}
