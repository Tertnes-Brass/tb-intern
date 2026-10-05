// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), upload: vi.fn(), navigate: vi.fn(), publish: vi.fn(), toast: vi.fn(), remove: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => state.navigate, useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: unknown }) => children,
}))
vi.mock('../server/posts', () => ({ createPost: state.create, updatePost: state.update, publishPost: state.publish, deletePostImage: vi.fn(), searchMentionableForAudience: vi.fn() }))
vi.mock('../server/post-attachments', () => ({ deletePostAttachment: state.remove }))
vi.mock('../lib/post-attachments', async (original) => ({ ...await original<typeof import('../lib/post-attachments')>(), uploadPostAttachment: state.upload }))
vi.mock('./toast', () => ({ toast: state.toast, toastError: state.toast }))
vi.mock('./MentionTextarea', async () => {
  const { createElement } = await import('react')
  return { MentionTextarea: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => createElement('textarea', { value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }) }
})
import { PostForm } from './PostForm'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  state.create.mockResolvedValue({ id: 'new-draft' })
  state.publish.mockResolvedValue({})
})
afterEach(async () => { await act(() => root.unmount()); container.remove() })

it('viser ikke vedleggsopplasting for vanlige medlemmer', async () => {
  await act(() => root.render(createElement(PostForm, { canPublish: false })))
  expect(container.textContent).not.toContain('Legg til vedlegg')
})

it('beholder samme utkast og hopper over vellykkede vedlegg når opplasting prøves igjen', async () => {
  await act(() => root.render(createElement(PostForm, { canPublish: true })))
  const textarea = container.querySelector('textarea')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Beskjed med vedlegg')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const picker = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
  const first = new File(['PDF1'], 'første.pdf')
  const second = new File(['PDF2'], 'andre.pdf')
  Object.defineProperty(picker, 'files', { configurable: true, value: [first, second] })
  await act(() => picker.dispatchEvent(new Event('change', { bubbles: true })))
  state.upload.mockResolvedValueOnce({ id: 'a', fileName: first.name, size: first.size }).mockRejectedValueOnce(new Error('Nettverksfeil'))
  await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(state.create).toHaveBeenCalledTimes(1)
  expect(state.navigate).not.toHaveBeenCalled()
  expect(container.textContent).toContain('Åpne den lagrede beskjeden')
  expect(container.querySelectorAll('a')).toHaveLength(1)
  state.upload.mockResolvedValueOnce({ id: 'b', fileName: second.name, size: second.size })
  await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(state.create).toHaveBeenCalledTimes(1)
  expect(state.update).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'new-draft' }) })
  expect(state.upload.mock.calls.map((call) => call[1].name)).toEqual(['første.pdf', 'andre.pdf', 'andre.pdf'])
  expect(state.navigate).toHaveBeenCalledWith({ to: '/beskjeder/$postId', params: { postId: 'new-draft' } })
})

it('kan fjerne eksisterende og legge til nye vedlegg på en publisert beskjed', async () => {
  await act(() => root.render(createElement(PostForm, { canPublish: true, post: {
    id: 'published-post', title: 'Beskjed', body: 'Publisert tekst', format: 'plain_text', audience: 'all', importance: 'normal',
    official: true, fromArchive: false, publishedAt: 1, images: [], mentions: [], attachments: [{ id: 'old', fileName: 'original.pdf', size: 4 }],
  } })))
  expect(container.querySelector('a')?.getAttribute('href')).toBe('/api/post-attachments/old')
  await act(() => container.querySelector<HTMLButtonElement>('[aria-label="Fjern original.pdf"]')!.click())
  expect(state.remove).toHaveBeenCalledWith({ data: { id: 'old' } })
  expect(container.textContent).not.toContain('original.pdf')
  const picker = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
  const file = new File(['new'], 'ny.pdf')
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] })
  await act(() => picker.dispatchEvent(new Event('change', { bubbles: true })))
  state.upload.mockResolvedValueOnce({ id: 'new', fileName: file.name, size: file.size })
  await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(state.create).not.toHaveBeenCalled()
  expect(state.update).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'published-post' }) })
  expect(state.upload).toHaveBeenCalledWith('published-post', file)
  expect(state.publish).not.toHaveBeenCalled()
})
