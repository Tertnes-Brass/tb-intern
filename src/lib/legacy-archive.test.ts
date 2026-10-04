// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parseArchiveWorkbook } from './legacy-archive'
function workbook(rows: string, date1904 = false) {
  return zipSync({
    'xl/workbook.xml': strToU8(`<workbook><workbookPr date1904="${date1904 ? 1 : 0}"/></workbook>`),
    'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData/></worksheet>'),
  })
}
const text = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
const header = `<row r="1">${text('A1', 'MusicID')}${text('C1', 'Digitalisert')}${text('D1', 'Title')}${text('H1', 'Last_check')}${text('J1', 'Notes')}</row>`
it('bevarer tekstnummer, tolker tall, manglende nummer, merknader og datoer', () => {
  const rows = `${header}<row r="2">${text('A2', '0012')}${text('D2', 'Aria &amp; sang')}${text('J2', 'Mangler partitur')}<c r="H2"><v>43831</v></c>${text('C2', 'X')}</row><row r="3"><c r="A3"><v>1624.0</v></c>${text('D3', 'Neste')}</row><row r="4">${text('D4', 'Uten nummer')}</row>`
  const result = parseArchiveWorkbook(workbook(rows), 'liste.xlsx')
  expect(result.entries.map((e) => e.archiveNumber)).toEqual(['0012', '1624', null])
  expect(result.entries[0]).toMatchObject({ title: 'Aria & sang', notes: 'Mangler partitur', lastChecked: '2020-01-01', markedDigitized: true, sourceRow: 2 })
})
it('leser også det gamle kolonneoppsettet', () => {
  const rows = `<row r="1">${text('A1', 'MusicID')}${text('B1', 'Title')}${text('C1', 'Composer')}</row><row r="2"><c r="A2"><v>1000</v></c>${text('B2', 'Stykke')}${text('C2', 'Komponist')}</row>`
  expect(parseArchiveWorkbook(workbook(rows), 'gammel.xlsx').entries[0]).toMatchObject({ archiveNumber: '1000', title: 'Stykke', composer: 'Komponist', markedDigitized: false })
})
it('avviser duplikate nummer og manglende titler', () => {
  expect(() => parseArchiveWorkbook(workbook(`${header}<row r="2">${text('A2', '1')}${text('D2', 'A')}</row><row r="3">${text('A3', '1')}${text('D3', 'B')}</row>`), 'a.xlsx')).toThrow('duplikate')
  expect(() => parseArchiveWorkbook(workbook(`${header}<row r="2">${text('A2', '1')}</row>`), 'a.xlsx')).toThrow('Tittel mangler')
})
