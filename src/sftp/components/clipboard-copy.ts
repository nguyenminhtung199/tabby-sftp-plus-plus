import { log } from '../../services/sftp-logger'

export function copyTextToClipboard(text: string): boolean {
  try {
    const electron = (window as any).require('electron')
    electron.clipboard.writeText(text)
    return true
  } catch (e) {
    log.warn('copyTextToClipboard failed', e)
    return false
  }
}

export function copyImageToClipboard(dataUrl: string): boolean {
  try {
    const electron = (window as any).require('electron')
    const img = electron.nativeImage.createFromDataURL(dataUrl)
    electron.clipboard.writeImage(img)
    return true
  } catch (e) {
    log.warn('copyImageToClipboard failed', e)
    return false
  }
}
