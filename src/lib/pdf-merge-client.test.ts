import { afterEach, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { mergeSelectedPdfs } from './pdf-merge-client'

afterEach(() => vi.unstubAllGlobals())

it('samler alle sider i fil- og siderekkefølge og bevarer sidestørrelser', async () => {
  const first = await PDFDocument.create()
  first.addPage([100, 200])
  first.addPage([300, 400])
  const second = await PDFDocument.create()
  second.addPage([500, 600])
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(await first.save()))).mockResolvedValueOnce(new Response(new Uint8Array(await second.save())))
  vi.stubGlobal('fetch', fetcher)
  const progress = vi.fn()
  const bytes = await mergeSelectedPdfs([{ fileId: 'a/b', name: 'Horn.pdf' }, { fileId: 'score', name: 'Partitur.pdf' }], progress)
  const result = await PDFDocument.load(bytes)
  expect(result.getPages().map((p) => p.getSize())).toEqual([{ width: 100, height: 200 }, { width: 300, height: 400 }, { width: 500, height: 600 }])
  expect(fetcher).toHaveBeenNthCalledWith(1, '/api/files/a%2Fb?download=1', { credentials: 'same-origin' })
  expect(progress).toHaveBeenLastCalledWith(2, 2)
})

it.each([403, 404, 401])('avbryter ved HTTP %s i stedet for å levere en ufullstendig PDF', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })))
  await expect(mergeSelectedPdfs([{ fileId: 'a', name: 'Horn.pdf' }])).rejects.toThrow('Ingen samlet PDF er lastet ned')
})

it('avviser uleselig PDF og tomt utvalg', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ikke en PDF')))
  await expect(mergeSelectedPdfs([{ fileId: 'a', name: 'Horn.pdf' }])).rejects.toThrow('Horn.pdf')
  await expect(mergeSelectedPdfs([])).rejects.toThrow('Velg minst én PDF-fil')
})
