// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, component: undefined as unknown, upload: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: unknown }) => {
    state.component = options.component
    return { useLoaderData: () => state.data }
  },
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  redirect: vi.fn(),
  Link: ({ children }: { children: unknown }) => children,
}))
vi.mock('../server/works', () => ({
  addWorkLink: vi.fn(), deleteWork: vi.fn(), deleteWorkFile: vi.fn(), deleteWorkFiles: vi.fn(),
  deleteWorkLink: vi.fn(), getWork: vi.fn(), rematchWorkFiles: vi.fn(), setWorkFilePart: vi.fn(),
}))
vi.mock('./upload-client', () => ({ uploadWorkFile: state.upload }))
vi.mock('../components/WorkEditions', () => ({ WorkEditions: () => null }))
vi.mock('../components/WorkForm', () => ({ WorkFormModal: () => null }))
vi.mock('../components/ZipDownload', () => ({ ZipDownloadButton: () => null }))
vi.mock('../components/PdfSplitter', () => ({ PdfSplitterLauncher: () => 'Del opp PDF' }))
vi.mock('../components/toast', () => ({ toast: vi.fn(), toastError: vi.fn() }))
import '../routes/noter/arkiv/$workId'

it('viser ett opplastingsfelt og én splitter etter gjentatte utgavebytter', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  state.upload.mockResolvedValue({ id: 'new-file', partId: 'cornet' })
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    for (const editionId of [null, 'edition-2', null, 'edition-2', 'edition-3', null]) {
      state.data = {
        work: { id: 'work-a', title: 'Conselho', currentEditionId: null },
        editionId, canManage: true, canViewScore: true, files: [], allParts: [], links: [], usedIn: [],
      }
      await act(async () => root.render(createElement(state.component as ComponentType)))
      expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1)
      expect(container.textContent?.match(/Slipp notefiler her/g)).toHaveLength(1)
      expect(container.textContent?.match(/Del opp PDF/g)).toHaveLength(1)
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['PDF'], 'Cornet.pdf', { type: 'application/pdf' })] })
      await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
      expect(state.upload).toHaveBeenLastCalledWith(expect.objectContaining({ workId: 'work-a', editionId }))
    }
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
  } finally {
    await act(async () => root.unmount())
    errors.mockRestore()
    container.remove()
  }
})
