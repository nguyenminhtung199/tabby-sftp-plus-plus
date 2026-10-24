import * as fs from 'fs'

export const DEFAULT_ICON_MAP: Record<string, string> = {

  '.txt': 'text.svg', '.log': 'text.svg', '.md': 'text.svg', '.markdown': 'text.svg',
  '.rtf': 'text.svg', '.csv': 'text.svg', '.ini': 'text.svg', '.conf': 'text.svg', '.cfg': 'text.svg',
  '.json': 'code.svg', '.xml': 'code.svg', '.yml': 'code.svg', '.yaml': 'code.svg',
  '.js': 'code.svg', '.ts': 'code.svg', '.jsx': 'code.svg', '.tsx': 'code.svg', '.mjs': 'code.svg',
  '.py': 'code.svg', '.java': 'code.svg', '.go': 'code.svg', '.c': 'code.svg', '.cpp': 'code.svg',
  '.h': 'code.svg', '.cs': 'code.svg', '.php': 'code.svg', '.rb': 'code.svg', '.rs': 'code.svg',
  '.sh': 'code.svg', '.bat': 'code.svg', '.ps1': 'code.svg', '.sql': 'code.svg', '.html': 'code.svg',
  '.css': 'code.svg', '.scss': 'code.svg', '.less': 'code.svg', '.vue': 'code.svg',

  '.pdf': 'pdf.svg',
  '.doc': 'doc.svg', '.docx': 'doc.svg', '.wps': 'doc.svg',
  '.ppt': 'ppt.svg', '.pptx': 'ppt.svg', '.dps': 'ppt.svg',
  '.xls': 'xls.svg', '.xlsx': 'xls.svg', '.et': 'xls.svg',

  '.zip': 'zip.svg', '.rar': 'zip.svg', '.7z': 'zip.svg', '.tar': 'zip.svg',
  '.gz': 'zip.svg', '.bz2': 'zip.svg', '.xz': 'zip.svg', '.tgz': 'zip.svg',

  '.exe': 'exe.svg', '.msi': 'exe.svg', '.com': 'exe.svg', '.scr': 'exe.svg',
  '.dmg': 'exe.svg', '.pkg': 'exe.svg', '.deb': 'exe.svg', '.rpm': 'exe.svg',
  '.run': 'exe.svg', '.bin': 'exe.svg', '.AppImage': 'exe.svg', '.apk': 'exe.svg',

  '.png': 'image.svg', '.jpg': 'image.svg', '.jpeg': 'image.svg', '.gif': 'image.svg',
  '.bmp': 'image.svg', '.webp': 'image.svg', '.svg': 'image.svg', '.ico': 'image.svg',
  '.tiff': 'image.svg', '.tif': 'image.svg', '.heic': 'image.svg', '.avif': 'image.svg',

  '.mp3': 'audio.svg', '.wav': 'audio.svg', '.flac': 'audio.svg', '.m4a': 'audio.svg',
  '.ogg': 'audio.svg', '.aac': 'audio.svg', '.wma': 'audio.svg', '.ape': 'audio.svg',

  '.mp4': 'video.svg', '.mkv': 'video.svg', '.avi': 'video.svg', '.mov': 'video.svg',
  '.webm': 'video.svg', '.flv': 'video.svg', '.wmv': 'video.svg', '.m4v': 'video.svg',
}

export const BUILTIN_ICON_FILES: string[] = (() => {
  const set = new Set<string>(Object.values(DEFAULT_ICON_MAP))
  set.add('default.svg')
  set.add('folder.svg')
  return [...set]
})()

export const FOLDER_ICON_SVG = 'folder.svg'

export const BUILTIN_ICON_EXTS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const [ext, svg] of Object.entries(DEFAULT_ICON_MAP)) {
    ;(m[svg] ||= []).push(ext)
  }
  return m
})()

export function resolveBundledIconDir(pluginPath?: string | null): string {
  if (!pluginPath) return ''
  const base = String(pluginPath).replace(/\\/g, '/').replace(/\/+$/, '')
  const candidates = [
    `${base}/dist/assets/icons`,
    `${base}/assets/icons`,
    `${base}/src/assets/icons`,
  ]
  try {
    return candidates.find(dir => fs.existsSync(dir)) || ''
  } catch {
    return ''
  }
}

export function resolveSftpPlusBundledIconDir(bootstrapData: any): string {
  try {
    const info = bootstrapData?.installedPlugins?.find(
      (p: any) => p.packageName === 'tabby-sftp-plus-plus',
    )
    return resolveBundledIconDir(info?.path)
  } catch {
    return ''
  }
}
