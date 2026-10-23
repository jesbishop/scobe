export function fileThumbnailUrl(
  file: { thumbnailUrl?: string; thumbnailDarkUrl?: string },
  theme: 'light' | 'dark'
): string | undefined {
  if (theme === 'dark') return file.thumbnailDarkUrl || file.thumbnailUrl
  return file.thumbnailUrl || file.thumbnailDarkUrl
}

export function fileHasThemeThumbnail(
  file: { thumbnailUrl?: string; thumbnailDarkUrl?: string },
  theme: 'light' | 'dark'
): boolean {
  if (theme === 'dark') return Boolean(file.thumbnailDarkUrl)
  return Boolean(file.thumbnailUrl)
}
