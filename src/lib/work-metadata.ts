import { z } from 'zod'

export const workMetadataInput = z.object({
  subtitle: z.string().optional(),
  archiveNumber: z.string().optional(),
})

export function normalizeWorkMetadata(input: z.infer<typeof workMetadataInput>) {
  return {
    subtitle: input.subtitle?.trim() || null,
    archiveNumber: input.archiveNumber?.trim() || null,
  }
}
