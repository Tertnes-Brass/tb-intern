export const MAX_POST_ATTACHMENTS = 10
export const MAX_POST_ATTACHMENT_BYTES = 25 * 1024 * 1024
export type PostAttachment = { id: string; fileName: string; size: number }

export function attachmentRejectionReason(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return 'Filen er tom'
  return size > MAX_POST_ATTACHMENT_BYTES ? 'Filen er større enn 25 MB' : null
}

export function attachmentFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  // Strip control characters and unmatched surrogates before building headers.
  return Array.from(base.replace(/[\u0000-\u001f\u007f]/g, '').trim()).filter((c) => !(c.length === 1 && /[\ud800-\udfff]/.test(c))).slice(0, 200).join('') || 'vedlegg'
}

export function attachmentDisposition(fileName: string): string {
  const name = attachmentFileName(fileName)
  const fallback = name.replace(/["\\]/g, "'").replace(/[^\x20-\x7e]/g, '_')
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export function postAttachmentUrl(id: string): string {
  return `/api/post-attachments/${encodeURIComponent(id)}`
}

export async function uploadPostAttachment(postId: string, file: File): Promise<PostAttachment> {
  const reason = attachmentRejectionReason(file.size)
  if (reason) throw new Error(`${file.name}: ${reason}`)
  const query = new URLSearchParams({ postId, fileName: file.name })
  const response = await fetch(`/api/post-attachments/upload?${query}`, {
    method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: file,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? 'Kunne ikke laste opp vedlegget')
  }
  return await response.json() as PostAttachment
}
