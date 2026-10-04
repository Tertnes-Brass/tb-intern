// @vitest-environment jsdom
import { act, createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown>, component: undefined as unknown, upload: vi.fn(), remove: vi.fn() }))
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
  addWorkLink: vi.fn(), deleteWork: vi.fn(), deleteWorkFile: vi.fn(), deleteWorkFiles: state.remove,
  deleteWorkLink: vi.fn(), getWork: vi.fn(), rematchWorkFiles: vi.fn(), setWorkFilePart: vi.fn(),
}))
vi.mock('./upload-client', () => ({ uploadWorkFile: state.upload }))
vi.mock('../components/WorkEditions', () => ({ WorkEditions: () => null }))
vi.mock('../components/WorkForm', () => ({ WorkFormModal: () => null }))
vi.mock('../components/ZipDownload', () => ({ ZipDownloadButton: () => null }))
vi.mock('../components/PdfSplitter', () => ({ PdfSplitterLauncher: () => 'Del opp PDF' }))
vi.mock('../components/toast', () => ({ toast: vi.fn(), toastError: vi.fn() }))
vi.mock('../components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ui')>()
  return { ...actual, Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? createElement('div', { role: 'dialog' }, children) : null }
})
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


it('velger og sletter bare filtrerte treff, og tømmer valget når filteret endres', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  state.remove.mockResolvedValue({ deleted: 2 })
  state.data = {
    work: { id: 'work-a', title: 'Conselho', currentEditionId: null }, editionId: null,
    canManage: true, canViewScore: true, allParts: [], links: [], usedIn: [],
    files: ['Conselho 1 Cornet.pdf', 'Conselho 3 Cornet.pdf', 'Conselho 3 Score.pdf'].map((fileName, i) => ({
      id: `file-${i}`, fileName, kind: i === 2 ? 'score' : 'part', partSection: i === 2 ? 'score' : 'cornet',
      partName: 'Kornett', partId: 'cornet', fileSize: 100, pageCount: 1,
    })),
  }
  const click = async (text: string) => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text)!
    expect(button).toBeDefined()
    await act(async () => button.click())
  }
  const filter = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    await act(async () => input.dispatchEvent(new Event('input', { bubbles: true })))
  }
  try {
    await act(async () => root.render(createElement(state.component as ComponentType)))
    await filter('conselho 3')
    expect(container.textContent).toContain('Viser 2 av 3 filer')
    await click('Velg flere filer')
    await click('Velg alle viste')
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2)
    await filter('Conselho 1')
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(0)
    expect(container.textContent).toContain('0 filer valgt')
    await filter('Conselho 3')
    await click('Velg alle viste')
    await click('Slett valgte (2)')
    expect(container.querySelector('[role="dialog"]')?.textContent).not.toContain('Conselho 1 Cornet.pdf')
    await click('Slett 2 filer')
    expect(state.remove).toHaveBeenCalledWith({ data: { workId: 'work-a', fileIds: ['file-1', 'file-2'] } })
  } finally {
    await act(async () => root.unmount())
    errors.mockRestore()
    container.remove()
  }
})
