// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), upload: vi.fn(), navigate: vi.fn(), publish: vi.fn(), toast: vi.fn(), remove: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => state.navigate, useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: unknown }) => children,
  useBlocker: () => ({ status: 'idle' }),
}))
vi.mock('../server/posts', () => ({ createPost: state.create, updatePost: state.update, publishPost: state.publish, deletePostImage: vi.fn(), searchMentionableForAudience: vi.fn() }))
vi.mock('../server/post-attachments', () => ({ deletePostAttachment: state.remove }))
vi.mock('../lib/post-attachments', async (original) => ({ ...await original<typeof import('../lib/post-attachments')>(), uploadPostAttachment: state.upload }))
vi.mock('./toast', () => ({ toast: state.toast, toastError: state.toast }))
vi.mock('./MentionTextarea', async () => {
  const { createElement } = await import('react')
  return { MentionTextarea: ({ value, onChange, id, 'aria-describedby': describedBy }: { value: string; onChange: (value: string) => void; id?: string; 'aria-describedby'?: string }) => createElement('textarea', { value, id, 'aria-describedby': describedBy, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }) }
})
import { PostForm } from './PostForm'

// Node 22+ har en egen `localStorage` som er tom uten `--localstorage-file`, og
// den skygger for jsdom sin. Et lite minnelager holder for testene.
if (!window.localStorage) {
  const data = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() { return data.size },
    },
  })
}

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  window.localStorage.clear()
  // jsdom har ikke showModal; arkene rendres uansett, vi trenger bare at kallet ikke kaster.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
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
  // Sletting av et lagret vedlegg spør først — det skjer på serveren med en gang.
  expect(state.remove).not.toHaveBeenCalled()
  await act(() => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Fjern vedlegget')!.click())
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

it('Publiser åpner et ark der varselet er avslått, og publiserer uten e-post', async () => {
  await act(() => root.render(createElement(PostForm, { canPublish: true })))
  const textarea = container.querySelector('textarea')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Viktig beskjed')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const button = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!
  await act(() => button('Publiser').click())
  const notify = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  expect(notify.checked).toBe(false)
  expect(state.publish).not.toHaveBeenCalled()
  await act(() => button('Publiser uten varsel').click())
  expect(state.publish).toHaveBeenCalledWith({ data: { id: 'new-draft', sendEmail: false } })
})

it('kobler tekstfeltets etikett og hjelpetekst til feltet', async () => {
  await act(() => root.render(createElement(PostForm, { canPublish: false })))
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === 'Tekst')!
  const field = container.querySelector('textarea')!
  expect(label.htmlFor).toBe(field.id)
  expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toContain('Skriv @')
})

const type = async (text: string) => {
  const textarea = container.querySelector('textarea')!
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('lagrer teksten på enheten og gjenoppretter den neste gang', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  try {
    await act(() => root.render(createElement(PostForm, { canPublish: false, draftKey: 'tb-draft:u1:new-post' })))
    await type('Halvferdig innlegg')
    await act(() => vi.advanceTimersByTime(1000))
    expect(JSON.parse(window.localStorage.getItem('tb-draft:u1:new-post')!).data.body).toBe('Halvferdig innlegg')
    expect(container.textContent).toContain('Lagret på enheten')

    await act(() => root.unmount())
    root = createRoot(container)
    await act(() => root.render(createElement(PostForm, { canPublish: false, draftKey: 'tb-draft:u1:new-post' })))
    expect(container.querySelector('textarea')!.value).toBe('Halvferdig innlegg')
    expect(container.textContent).toContain('Gjenopprettet utkast fra kl.')

    // En annen bruker på samme enhet får ikke utkastet.
    await act(() => root.unmount())
    root = createRoot(container)
    await act(() => root.render(createElement(PostForm, { canPublish: false, draftKey: 'tb-draft:u2:new-post' })))
    expect(container.querySelector('textarea')!.value).toBe('')
  } finally {
    vi.useRealTimers()
  }
})

it('«Forkast» tømmer feltet og sletter utkastet, og publisering rydder det bort', async () => {
  window.localStorage.setItem('tb-draft:u1:new-post', JSON.stringify({ v: 1, savedAt: Date.now(), data: {
    title: '', body: 'Gammel tekst', chosen: [], format: 'plain_text', audience: 'all', importance: 'normal', official: false, fromArchive: false,
  } }))
  await act(() => root.render(createElement(PostForm, { canPublish: false, draftKey: 'tb-draft:u1:new-post' })))
  expect(container.querySelector('textarea')!.value).toBe('Gammel tekst')
  expect(container.querySelector('.draft-notice')?.textContent).toContain('Gjenopprettet utkast fra kl.')
  await act(() => container.querySelector<HTMLButtonElement>('.draft-notice-action')!.click())
  expect(container.querySelector('textarea')!.value).toBe('')
  expect(window.localStorage.getItem('tb-draft:u1:new-post')).toBeNull()

  await type('Ny tekst')
  await act(() => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(state.publish).toHaveBeenCalled()
  await act(() => root.unmount())
  root = createRoot(container)
  expect(window.localStorage.getItem('tb-draft:u1:new-post')).toBeNull()
})
