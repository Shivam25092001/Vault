/** Human-readable byte size, matching the design's formatting. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Uppercased file extension badge, e.g. "PDF", "MP4", or "FILE" when absent. */
export function extOf(name: string): string {
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()!.toUpperCase().slice(0, 4) : 'FILE';
}

export function isImageType(type: string): boolean {
  return type.startsWith('image/');
}
