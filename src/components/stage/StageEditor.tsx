/**
 * Editoren for sceneoppsett — Excalidraw i fullskjerm, med komponentpaletten,
 * utstyrslisten og merknadene i en spalte ved siden av.
 *
 * Denne modulen drar inn Excalidraw (~2 MB) og lastes derfor KUN dynamisk, via
 * `StageEditorLoader.tsx` — aldri importer den direkte. `import.meta.env.SSR`-
 * vakten i lasteren holder den ute av Worker-bundelen.
 *
 * Lagring: `StageSaveQueue` lagrer automatisk litt etter siste endring, med
 * revisjonskontroll mot serveren. Excalidraw sender `onChange` for hver
 * musebevegelse mens man drar; vi tar et øyeblikksbilde først når det har
 * vært stille et lite øyeblikk (`commit`), og alltid før vi lagrer, eksporterer
 * eller forlater siden.
 */
import '@excalidraw/excalidraw/index.css'
import './stage-editor.css'
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  exportToBlob,
  hashElementsVersion,
  loadFromBlob,
  restoreElements,
  restoreLibraryItems,
  serializeAsJSON,
  viewportCoordsToSceneCoords,
} from '@excalidraw/excalidraw'
import type {
  AppState,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement, OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { useBlocker } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { formatDate, formatDateTime, formatWeekday } from '../../lib/format'
import { type ArrangeResult, type StageSelection, describeSelection, faceConductor, setChairCount } from '../../lib/stage-arrange'
import {
  STAGE_COMPONENTS,
  buildStageComponent,
  equipmentList,
  percussionRigOrder,
  stageKind,
  stageSize,
} from '../../lib/stage-components'
import { type ElementContext, STAGE_FONT_FAMILY, type SceneElement, elementContext } from '../../lib/stage-elements'
import { StageSaveQueue } from '../../lib/stage-save-queue'
import {
  EMPTY_STAGE_APP_STATE,
  STAGE_CONTACT_MAX,
  STAGE_ELEMENT_TYPES,
  STAGE_NOTES_MAX,
  STAGE_TITLE_MAX,
  type StageContact,
  stageFileName,
} from '../../lib/stage-scene'
import { saveBlob } from '../../lib/zip-client'
import { deleteStageSetup, saveStageSetup, type StageSetupDetail } from '../../server/stage-setups'
import { toast, toastError } from '../toast'
import { BottomSheet, Button, Modal } from '../ui'
import { STAGE_DRAG_TYPE, StagePalette } from './StagePalette'

declare const __EXCALIDRAW_ASSET_BASE__: string

// Fontene til tegningen serveres fra vårt eget domene (se vite.config.ts).
// Leses av Excalidraw først når editoren monteres, så det holder å sette den her.
;(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL(
  __EXCALIDRAW_ASSET_BASE__,
  window.location.origin,
).href

const STORED_TYPES = new Set<string>(STAGE_ELEMENT_TYPES)
const LIBRARY_KEY = 'tb-stage-library'
const CATALOG_PREFIX = 'tb-'
const KIND_LABEL: Record<string, string> = { konsert: 'Konsert', konkurranse: 'Konkurranse', seminar: 'Seminar' }

type Scene = { elements: SceneElement[]; appState: Record<string, unknown> }

const NO_SELECTION: StageSelection = { chairs: 0, doubles: 0, stands: 0 }

function selectedIds(appState: Pick<AppState, 'selectedElementIds'>): Set<string> {
  return new Set(Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]))
}

function sceneFrom(elements: readonly ExcalidrawElement[], appState: AppState): Scene {
  return {
    elements: elements.filter((e) => !e.isDeleted && STORED_TYPES.has(e.type)) as unknown as SceneElement[],
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize,
      gridStep: appState.gridStep,
      gridModeEnabled: appState.gridModeEnabled,
    },
  }
}

/** Komponentene ligger også i Excalidraw sitt eget bibliotek, der de kan dras inn. */
function catalogLibrary(): LibraryItems {
  return STAGE_COMPONENTS.map((c) => ({
    id: `${CATALOG_PREFIX}${c.id}`,
    status: 'unpublished' as const,
    created: 0,
    name: c.label,
    elements: restoreElements(buildStageComponent(c.id) as unknown as ExcalidrawElement[], null),
  }))
}

/** Egne bibliotekselementer huskes på denne enheten (ikke delt med andre). */
function storedLibrary(): LibraryItems {
  try {
    const raw = window.localStorage.getItem(LIBRARY_KEY)
    return raw ? restoreLibraryItems(JSON.parse(raw), 'unpublished') : []
  } catch {
    return []
  }
}

function useAppTheme(): 'light' | 'dark' {
  const read = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  const [theme, setTheme] = useState<'light' | 'dark'>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

export default function StageEditor({
  data,
  onLeave,
  onReload,
}: {
  data: StageSetupDetail
  onLeave: () => void
  /** Hent siste versjon fra serveren og start editoren på nytt. */
  onReload: () => Promise<void>
}) {
  const { setup, project, canEdit, myContact } = data
  const [scene] = useState(() => JSON.parse(setup.sceneJson) as Scene)
  const theme = useAppTheme()
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [elements, setElements] = useState<SceneElement[]>(() => scene.elements)
  const [panel, setPanel] = useState<'components' | 'info'>(canEdit ? 'components' : 'info')
  const [sheet, setSheet] = useState<null | 'components' | 'info'>(null)
  const [busy, setBusy] = useState<null | 'pdf' | 'delete' | 'reload'>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selection, setSelection] = useState<StageSelection>(NO_SELECTION)
  const importInput = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  /** Har brukeren rørt tegningen? Første `onChange` før det er bare innlastingen. */
  const interacted = useRef(false)
  const firstChange = useRef(true)
  const lastKey = useRef('')
  const pending = useRef<Scene | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const warnedUnsupported = useRef(false)
  const fitted = useRef(false)
  const allowLeave = useRef(false)
  const lastSelection = useRef<{ ids: unknown; key: string }>({ ids: null, key: '' })

  const [queue] = useState(
    () =>
      new StageSaveQueue(
        { title: setup.title, notes: setup.notes ?? '', contact: setup.contact, scene },
        setup.revision,
        (draft, expectedRevision) =>
          saveStageSetup({
            data: {
              id: setup.id,
              expectedRevision,
              title: draft.title,
              notes: draft.notes,
              contact: draft.contact,
              scene: draft.scene,
            },
          }),
        rerender,
      ),
  )
  useEffect(() => () => queue.dispose(), [queue])

  /** Legger siste tegning inn i lagringskøen nå, i stedet for om et øyeblikk. */
  const commit = useCallback(() => {
    clearTimeout(commitTimer.current)
    const scene = pending.current
    if (!scene) return
    pending.current = null
    setElements(scene.elements)
    if (!canEdit) return
    const draft = { ...queue.draft, scene }
    if (firstChange.current) {
      firstChange.current = false
      if (!interacted.current) return queue.rebase(draft)
    }
    queue.update(draft)
  }, [canEdit, queue])

  const onChange = useCallback(
    (els: readonly OrderedExcalidrawElement[], appState: AppState) => {
      const hash = hashElementsVersion(els)
      if (canEdit && (appState.selectedElementIds !== lastSelection.current.ids || lastKey.current.split('|')[0] !== String(hash))) {
        // Verktøylinja over tegningen følger utvalget (og om stolene er doble).
        const next = describeSelection(els as unknown as SceneElement[], selectedIds(appState))
        const selectionKey = `${next.chairs}|${next.doubles}|${next.stands}`
        if (selectionKey !== lastSelection.current.key) setSelection(next)
        lastSelection.current = { ids: appState.selectedElementIds, key: selectionKey }
      }
      const key = `${hash}|${appState.viewBackgroundColor}|${appState.gridSize}|${appState.gridStep}|${appState.gridModeEnabled}`
      if (key === lastKey.current) return
      lastKey.current = key
      if (!fitted.current && apiRef.current) {
        // Hele scenen i bildet ved åpning — ikke bare midten i 100 %.
        fitted.current = true
        const api = apiRef.current
        requestAnimationFrame(() => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.9, animate: false }))
      }
      if (!warnedUnsupported.current && els.some((e) => !e.isDeleted && !STORED_TYPES.has(e.type))) {
        warnedUnsupported.current = true
        toast('Bilder og innebygde nettsider lagres ikke i et sceneoppsett', 'error')
      }
      pending.current = sceneFrom(els, appState)
      clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(commit, firstChange.current ? 0 : 200)
    },
    [canEdit, commit],
  )

  const updateDraft = (patch: { title?: string; notes?: string; contact?: StageContact }) => {
    commit()
    queue.update({ ...queue.draft, ...patch })
  }

  const flushAll = useCallback(async () => {
    commit()
    if (!queue.dirty && queue.status !== 'saving') return true
    return queue.flush()
  }, [commit, queue])

  useBlocker({
    shouldBlockFn: async () => {
      if (allowLeave.current || !canEdit) return false
      if (await flushAll()) return false
      return !window.confirm('Endringene i sceneoppsettet er ikke lagret. Vil du gå likevel?')
    },
    enableBeforeUnload: () => {
      if (!canEdit || allowLeave.current) return false
      commit()
      return queue.dirty || queue.status === 'saving'
    },
  })

  const [initialData] = useState<ExcalidrawInitialDataState>(() => ({
    elements: structuredClone(scene.elements) as unknown as ExcalidrawElement[],
    appState: {
      ...EMPTY_STAGE_APP_STATE,
      ...scene.appState,
      currentItemFontFamily: STAGE_FONT_FAMILY,
      currentItemRoughness: 0,
      currentItemStrokeWidth: 1,
    } as ExcalidrawInitialDataState['appState'],
    libraryItems: [...catalogLibrary(), ...storedLibrary()],
  }))

  const onLibraryChange = useCallback((items: LibraryItems) => {
    try {
      const own = items.filter((item) => !item.id.startsWith(CATALOG_PREFIX))
      const json = JSON.stringify(own)
      if (json.length < 2_000_000) window.localStorage.setItem(LIBRARY_KEY, json)
    } catch {}
  }, [])

  /**
   * Gir tastaturet tilbake til tegningen etter et trykk i paletten eller
   * verktøylinja — ellers virker ikke ⌘Z/Ctrl+Z og Esc før man klikker i den
   * (`handleKeyboardGlobally` er av, så Excalidraw lytter bare på seg selv).
   */
  const refocus = useCallback(() => {
    canvasRef.current?.querySelector<HTMLElement>('.excalidraw-container')?.focus({ preventScroll: true })
  }, [])

  /** Setter inn en komponent med senter i `at` (scenekoordinater), eller midt i bildet. */
  const insert = useCallback((id: string, at?: { x: number; y: number }) => {
    const api = apiRef.current
    if (!api) return
    interacted.current = true
    const state = api.getAppState()
    const center = at ?? {
      x: -state.scrollX + state.width / 2 / state.zoom.value,
      y: -state.scrollY + state.height / 2 / state.zoom.value,
    }
    const snap = (n: number) => Math.round(n / 20) * 20
    const fresh = restoreElements(
      buildStageComponent(id, { x: snap(center.x), y: snap(center.y) }) as unknown as ExcalidrawElement[],
      null,
      { refreshDimensions: true, repairBindings: true },
    )
    const groupId = fresh[0]?.groupIds.at(-1)
    api.updateScene({
      elements: [...api.getSceneElementsIncludingDeleted(), ...fresh],
      appState: {
        selectedElementIds: Object.fromEntries(fresh.map((e) => [e.id, true])) as AppState['selectedElementIds'],
        selectedGroupIds: groupId ? { [groupId]: true } : {},
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    api.setActiveTool({ type: 'selection' })
    refocus()
  }, [refocus])

  /**
   * Kjører en endring fra `stage-arrange.ts` på hele tegningen, som ett steg i
   * angre-historikken. Nye elementer (en ekstra stol) går gjennom
   * `restoreElements` først, som alt annet vi setter inn.
   */
  const arrange = (
    run: (elements: SceneElement[], ctx: ElementContext, selected: Set<string>) => ArrangeResult,
    opts: { all?: boolean } = {},
  ) => {
    const api = apiRef.current
    if (!api || !canEdit) return 0
    interacted.current = true
    const current = api.getSceneElementsIncludingDeleted() as unknown as SceneElement[]
    const result = run(current, elementContext(), opts.all ? new Set() : selectedIds(api.getAppState()))
    if (result.changed === 0) return 0
    const existing = new Set(current.map((e) => e.id))
    const fresh = new Map(
      restoreElements(result.elements.filter((e) => !existing.has(e.id)) as unknown as ExcalidrawElement[], null).map((e) => [e.id, e]),
    )
    api.updateScene({
      elements: result.elements.map((e) => fresh.get(e.id) ?? e) as unknown as ExcalidrawElement[],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    })
    refocus()
    return result.changed
  }

  const turnToConductor = (all = false) => {
    const api = apiRef.current
    if (!api) return
    if (!api.getSceneElements().some((e) => stageKind(e) === 'podium')) {
      toast('Sett inn et dirigentpodium først (under «Scene»)', 'error')
      refocus()
      return
    }
    const changed = arrange((els, ctx, selected) => faceConductor(els, ctx, selected), { all })
    toast(changed ? 'Stativene er snudd mot dirigenten. Angre med Ctrl/⌘+Z.' : 'Stativene står allerede mot dirigenten')
  }

  const setChairs = (count: 1 | 2) => arrange((els, ctx, selected) => setChairCount(els, ctx, selected, count))

  const subtitle = [
    KIND_LABEL[project.kind] ?? null,
    project.eventDate ? `${formatWeekday(project.eventDate)} ${formatDate(project.eventDate)}` : null,
    project.venue,
  ]
    .filter(Boolean)
    .join(' · ')

  const exportPdf = async () => {
    const api = apiRef.current
    if (!api || busy) return
    commit()
    setBusy('pdf')
    try {
      const els = api.getSceneElements()
      if (els.length === 0) throw new Error('Tegningen er tom')
      const png = await exportToBlob({
        elements: els,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
          exportWithDarkMode: false,
          exportEmbedScene: false,
          viewBackgroundColor: '#ffffff',
        },
        files: api.getFiles(),
        mimeType: 'image/png',
        maxWidthOrHeight: 3200,
        exportPadding: 24,
      })
      const { buildStagePdf } = await import('./stage-pdf')
      const pdf = await buildStagePdf({
        png,
        title: queue.draft.title,
        projectName: project.name,
        subtitle,
        stageSize: stageSize(els as unknown as SceneElement[]),
        equipment: equipmentList(els as unknown as SceneElement[], { instruments: false }),
        percussion: percussionRigOrder(els as unknown as SceneElement[]),
        contact: queue.draft.contact,
        notes: queue.draft.notes.trim() || null,
        printedOn: formatDate(new Date().toISOString().slice(0, 10)),
      })
      saveBlob(pdf, stageFileName(project.name, queue.draft.title, 'pdf'))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const downloadExcalidraw = () => {
    const api = apiRef.current
    if (!api) return
    const json = serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), 'local')
    saveBlob(new Blob([json], { type: 'application/vnd.excalidraw+json' }), stageFileName(project.name, queue.draft.title, 'excalidraw'))
  }

  const importExcalidraw = async (file: File) => {
    const api = apiRef.current
    if (!api) return
    try {
      if (file.size > 5_000_000) throw new Error('Fila er for stor')
      const loaded = await loadFromBlob(file, null, null)
      const kept = loaded.elements.filter((e) => !e.isDeleted && STORED_TYPES.has(e.type))
      interacted.current = true
      api.updateScene({ elements: kept, captureUpdate: CaptureUpdateAction.IMMEDIATELY })
      api.scrollToContent(kept, { fitToContent: true })
      toast(
        kept.length < loaded.elements.filter((e) => !e.isDeleted).length
          ? 'Tegningen er importert — bilder ble utelatt. Angre med Ctrl/⌘+Z.'
          : 'Tegningen er importert. Angre med Ctrl/⌘+Z.',
      )
    } catch (err) {
      toastError(err instanceof Error ? new Error(`Kunne ikke importere: ${err.message}`) : err)
    }
  }

  const remove = async () => {
    setBusy('delete')
    try {
      await deleteStageSetup({ data: { id: setup.id } })
      allowLeave.current = true
      queue.dispose()
      toast('Oppsettet er slettet')
      onLeave()
    } catch (err) {
      toastError(err)
      setBusy(null)
    }
  }

  const reload = async () => {
    setBusy('reload')
    allowLeave.current = true
    try {
      await onReload()
    } catch (err) {
      allowLeave.current = false
      toastError(err)
      setBusy(null)
    }
  }

  const equipment = useMemo(() => equipmentList(elements, { instruments: false }), [elements])
  const rigOrder = useMemo(() => percussionRigOrder(elements), [elements])
  const size = useMemo(() => stageSize(elements), [elements])

  const info = (
    <InfoPanel
      canEdit={canEdit}
      equipment={equipment}
      rigOrder={rigOrder}
      stageSize={size}
      contact={queue.draft.contact}
      myContact={myContact}
      onContact={(contact) => updateDraft({ contact })}
      notes={queue.draft.notes}
      onNotes={(notes) => updateDraft({ notes })}
      savedLine={
        queue.lastSavedAt
          ? `Lagret ${formatDateTime(queue.lastSavedAt)}`
          : `Sist endret ${formatDateTime(setup.updatedAt)}${setup.updatedByName ? ` av ${setup.updatedByName}` : ''}`
      }
    />
  )

  return (
    <div className="stage-editor fixed inset-0 flex flex-col bg-paper text-ink">
      <header className="pt-safe shrink-0 border-b border-line bg-paper-raised">
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={onLeave}
            className="link-quiet inline-flex max-w-[16rem] shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint transition-colors hover:text-brass-strong"
            aria-label={`Tilbake til ${project.name}`}
          >
            ←<span className="hidden truncate lg:inline">{project.name}</span>
          </button>
          <div className="min-w-0 flex-1">
            {canEdit ? (
              <input
                aria-label="Navn på oppsettet"
                className="display-title w-full min-w-0 truncate rounded-md bg-transparent px-1 py-0.5 text-[1.05rem] font-semibold text-ink outline-none transition-colors hover:bg-paper-sunken focus:bg-paper-sunken"
                value={queue.draft.title}
                maxLength={STAGE_TITLE_MAX}
                onChange={(e) => updateDraft({ title: e.target.value })}
              />
            ) : (
              <h1 className="display-title truncate px-1 text-[1.05rem] font-semibold">{setup.title}</h1>
            )}
            <p className="truncate px-1 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-ink-faint">
              Sceneoppsett · {project.name}
            </p>
          </div>
          <SaveStatus queue={queue} canEdit={canEdit} />
          {canEdit && (
            <Button size="sm" className="md:hidden" onClick={() => setSheet('components')}>
              + Legg til
            </Button>
          )}
          <Button size="sm" variant="ghost" className="md:hidden" onClick={() => setSheet('info')}>
            Utstyr
          </Button>
          <Button size="sm" variant="primary" loading={busy === 'pdf'} onClick={exportPdf} title="Last ned PDF til arrangøren">
            <span className="sm:hidden">PDF</span>
            <span className="hidden sm:inline">Last ned PDF</span>
          </Button>
        </div>
        {(queue.status === 'conflict' || queue.status === 'error') && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-t border-danger/30 bg-danger/10 px-4 py-2 text-[0.82rem] text-ink">
            <span className="min-w-0 flex-1">
              {queue.status === 'conflict'
                ? `${queue.conflict?.updatedByName ?? 'Noen andre'} lagret oppsettet ${queue.conflict ? formatDateTime(queue.conflict.updatedAt) : ''} mens du tegnet. Endringene dine er ikke lagret.`
                : `Ikke lagret: ${queue.error instanceof Error ? queue.error.message : 'ukjent feil'}`}
            </span>
            {queue.status === 'error' && (
              <Button size="sm" onClick={() => void queue.flush()}>
                Prøv igjen
              </Button>
            )}
            <Button size="sm" onClick={downloadExcalidraw}>
              Last ned min kopi
            </Button>
            {queue.status === 'conflict' && (
              <Button size="sm" variant="primary" loading={busy === 'reload'} onClick={reload}>
                Hent siste versjon
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          ref={canvasRef}
          className="relative min-w-0 flex-1"
          onPointerDownCapture={() => (interacted.current = true)}
          onKeyDownCapture={() => (interacted.current = true)}
          onDragOverCapture={(e) => {
            if (!canEdit || !e.dataTransfer.types.includes(STAGE_DRAG_TYPE)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }}
          onDropCapture={(e) => {
            const id = e.dataTransfer.getData(STAGE_DRAG_TYPE)
            const api = apiRef.current
            if (!id || !canEdit || !api) return
            e.preventDefault()
            e.stopPropagation()
            const point = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState())
            insert(id, point)
          }}
        >
          <div className="absolute inset-0">
            <Excalidraw
              initialData={initialData}
              excalidrawAPI={(api) => {
                apiRef.current = api
              }}
              onChange={onChange}
              onLibraryChange={onLibraryChange}
              viewModeEnabled={!canEdit}
              theme={theme}
              langCode="nb-NO"
              name={queue.draft.title}
              aiEnabled={false}
              autoFocus
              handleKeyboardGlobally={false}
              validateEmbeddable={() => false}
              UIOptions={{
                canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
                tools: { image: false },
              }}
            >
              <MainMenu>
                <MainMenu.Item onSelect={exportPdf}>Last ned PDF til arrangøren</MainMenu.Item>
                <MainMenu.DefaultItems.SaveAsImage />
                <MainMenu.Item onSelect={downloadExcalidraw}>Last ned som .excalidraw</MainMenu.Item>
                {canEdit && (
                  <MainMenu.Item onSelect={() => importInput.current?.click()}>Importer .excalidraw-fil</MainMenu.Item>
                )}
                {canEdit && (
                  <>
                    <MainMenu.Separator />
                    <MainMenu.Item onSelect={() => turnToConductor(true)}>Snu alle stativ mot dirigenten</MainMenu.Item>
                  </>
                )}
                <MainMenu.Separator />
                {canEdit && <MainMenu.DefaultItems.ClearCanvas />}
                <MainMenu.DefaultItems.Help />
                {canEdit && <MainMenu.DefaultItems.ChangeCanvasBackground />}
                {canEdit && (
                  <>
                    <MainMenu.Separator />
                    <MainMenu.Item onSelect={() => setConfirmDelete(true)}>Slett oppsettet …</MainMenu.Item>
                  </>
                )}
              </MainMenu>
            </Excalidraw>
          </div>
          {canEdit && (selection.chairs > 0 || selection.stands > 0) && (
            <SelectionBar selection={selection} onChairs={setChairs} onFace={() => turnToConductor()} />
          )}
        </div>

        <aside className="hidden w-80 shrink-0 flex-col border-l border-line bg-paper md:flex">
          {canEdit && (
            <div className="flex shrink-0 gap-1 border-b border-line p-2" role="tablist">
              {(
                [
                  ['components', 'Komponenter'],
                  ['info', 'Utstyr og merknader'],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={panel === id}
                  onClick={() => setPanel(id)}
                  className={`flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[0.75rem] font-medium transition-colors ${
                    panel === id ? 'bg-[var(--brass-soft)] text-brass-strong' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {canEdit && panel === 'components' ? (
              <>
                <StagePalette onInsert={(id) => insert(id)} />
                <p className="mt-5 text-[0.74rem] leading-snug text-ink-faint">
                  Trykk for å sette inn midt i bildet, eller dra dit den skal stå. Dobbeltklikk på en stol for å skrive navn.
                  Velg stoler for å gjøre dem doble eller snu stativene mot dirigenten. Rutenettet har én hovedlinje per
                  meter.
                </p>
              </>
            ) : (
              info
            )}
          </div>
        </aside>
      </div>

      <BottomSheet
        open={sheet === 'components'}
        onClose={() => setSheet(null)}
        label="Legg til komponent"
        header={<p className="display-title text-lg font-semibold">Legg til</p>}
      >
        {sheet === 'components' && (
          <StagePalette
            onInsert={(id) => {
              insert(id)
              setSheet(null)
            }}
          />
        )}
      </BottomSheet>
      <BottomSheet
        open={sheet === 'info'}
        onClose={() => setSheet(null)}
        label="Utstyr og merknader"
        header={<p className="display-title text-lg font-semibold">Utstyr og merknader</p>}
      >
        {sheet === 'info' && info}
      </BottomSheet>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Slette oppsettet?" kicker={queue.draft.title}>
        <p className="mb-5 text-sm leading-relaxed text-ink-soft">
          Tegningen og merknadene slettes for godt. Last ned en kopi først hvis du vil ha den.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Avbryt
          </Button>
          <Button variant="danger" loading={busy === 'delete'} onClick={remove}>
            Slett oppsettet
          </Button>
        </div>
      </Modal>

      <input
        ref={importInput}
        type="file"
        accept=".excalidraw,application/vnd.excalidraw+json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importExcalidraw(file)
        }}
      />
    </div>
  )
}

function SaveStatus({ queue, canEdit }: { queue: StageSaveQueue; canEdit: boolean }) {
  if (!canEdit) {
    return <span className="stamp hidden shrink-0 sm:inline-flex">Bare lesing</span>
  }
  const text = {
    saved: 'Lagret',
    pending: 'Ikke lagret ennå',
    saving: 'Lagrer …',
    error: 'Ikke lagret',
    conflict: 'Ikke lagret',
  }[queue.status]
  const tone = queue.status === 'error' || queue.status === 'conflict' ? 'text-danger' : 'text-ink-faint'
  return (
    <span role="status" className={`hidden shrink-0 items-center gap-1.5 font-mono text-[0.62rem] uppercase tracking-[0.12em] sm:inline-flex ${tone}`}>
      {queue.status === 'saving' && <span className="spinner" aria-hidden />}
      {text}
    </span>
  )
}

/**
 * Verktøylinja over tegningen når stoler eller instrumenter med stativ er
 * valgt: enkel/dobbel stol og «Snu mot dirigenten».
 */
function SelectionBar({
  selection,
  onChairs,
  onFace,
}: {
  selection: StageSelection
  onChairs: (count: 1 | 2) => void
  onFace: () => void
}) {
  const segment = (active: boolean) =>
    `cursor-pointer rounded-md px-2.5 py-1.5 text-[0.76rem] font-medium transition-colors ${
      active ? 'bg-[var(--brass-soft)] text-brass-strong' : 'text-ink-soft hover:bg-paper-sunken hover:text-ink'
    }`
  const allDouble = selection.doubles === selection.chairs
  return (
    <div
      role="toolbar"
      aria-label="Valgte stoler og stativ"
      // Knappene skal ikke ta fokus fra tegningen (angre, Esc, piltaster).
      onMouseDown={(e) => e.preventDefault()}
      className="absolute inset-x-0 top-16 z-[5] mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-1 rounded-xl border border-line bg-paper-raised/95 p-1 shadow-md backdrop-blur md:top-[4.6rem]"
    >
      {selection.chairs > 0 && (
        <div role="group" aria-label="Stoler per plass" className="flex gap-0.5">
          <button type="button" aria-pressed={selection.doubles === 0} className={segment(selection.doubles === 0)} onClick={() => onChairs(1)}>
            Enkel stol
          </button>
          <button
            type="button"
            aria-pressed={allDouble}
            className={segment(allDouble)}
            onClick={() => onChairs(2)}
            title="En ekstra stol til instrument og dempere — telles med i utstyrslisten"
          >
            Dobbel stol
          </button>
        </div>
      )}
      {selection.chairs > 0 && selection.stands > 0 && <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />}
      {selection.stands > 0 && (
        <button type="button" className={segment(false)} onClick={onFace} title="Flytt notestativene så musikerne ser mot dirigentpodiet">
          Snu mot dirigenten
        </button>
      )}
    </div>
  )
}

function InfoPanel({
  canEdit,
  equipment,
  rigOrder,
  stageSize: size,
  contact,
  myContact,
  onContact,
  notes,
  onNotes,
  savedLine,
}: {
  canEdit: boolean
  equipment: ReturnType<typeof equipmentList>
  rigOrder: string[]
  stageSize: string | null
  contact: StageContact
  myContact: StageContact | null
  onContact: (contact: StageContact) => void
  notes: string
  onNotes: (notes: string) => void
  savedLine: string
}) {
  const contactEmpty = !contact.name.trim() && !contact.email.trim() && !contact.phone.trim()
  const contactField = (key: keyof StageContact, text: string, type: string, autoComplete: string) => (
    <label className="block">
      <span className="mb-1 block text-[0.72rem] font-medium text-ink-soft">{text}</span>
      <input
        className="field-input text-[0.86rem]"
        type={type}
        autoComplete={autoComplete}
        value={contact[key]}
        maxLength={STAGE_CONTACT_MAX[key]}
        onChange={(e) => onContact({ ...contact, [key]: e.target.value })}
      />
    </label>
  )
  return (
    <div className="space-y-6">
      <section>
        <h3 className="kicker mb-1.5">Scene</h3>
        <p className="text-[0.9rem] text-ink">{size ?? 'Ingen scene tegnet'}</p>
      </section>
      <section>
        <h3 className="kicker mb-1.5">Utstyr</h3>
        {equipment.length === 0 ? (
          <p className="text-[0.82rem] leading-snug text-ink-faint">
            Stoler, stativ, krakker og bord fra komponentene telles her automatisk.
          </p>
        ) : (
          <ul>
            {equipment.map((line) => (
              <li key={line.key} className="hairline-row flex items-baseline justify-between gap-3 py-1.5 text-[0.86rem]">
                <span className="text-ink-soft">{line.label}</span>
                <span className="font-mono font-medium text-ink">{line.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {rigOrder.length > 0 && (
        <section>
          <h3 className="kicker mb-1.5">Slagverk fra venstre</h3>
          <p className="text-[0.86rem] leading-relaxed text-ink">{rigOrder.join(', ')}</p>
          <p className="mt-1 text-[0.74rem] leading-snug text-ink-faint">Sett fra slagverket, mot salen — slik riggerne leser det.</p>
        </section>
      )}
      <section>
        <h3 className="kicker mb-1.5">Kontaktperson</h3>
        {canEdit ? (
          <div className="space-y-2.5">
            {contactField('name', 'Navn', 'text', 'name')}
            {contactField('email', 'E-post', 'email', 'email')}
            {contactField('phone', 'Telefon', 'tel', 'tel')}
            {contactEmpty && myContact && (
              <button type="button" className="link-brass cursor-pointer text-[0.78rem]" onClick={() => onContact(myContact)}>
                Bruk mine opplysninger
              </button>
            )}
          </div>
        ) : contactEmpty ? (
          <p className="text-[0.86rem] text-ink-soft">—</p>
        ) : (
          <p className="whitespace-pre-line text-[0.86rem] leading-relaxed text-ink-soft">
            {[contact.name, contact.email, contact.phone].filter((v) => v.trim()).join('\n')}
          </p>
        )}
      </section>
      <section>
        <h3 className="kicker mb-1.5">Merknader til arrangøren</h3>
        {canEdit ? (
          <>
            <textarea
              className="field-input min-h-36 resize-y text-[0.86rem] leading-relaxed"
              value={notes}
              maxLength={STAGE_NOTES_MAX}
              placeholder={'Rigging fra kl. 16:00\nVi tar med egne pauker\nTrenger strøm bak scenen'}
              onChange={(e) => onNotes(e.target.value)}
            />
            <p className="mt-1.5 text-[0.74rem] leading-snug text-ink-faint">
              Kommer med i PDF-en, sammen med kontaktpersonen og utstyrslisten.
            </p>
          </>
        ) : (
          <p className="whitespace-pre-line text-[0.86rem] leading-relaxed text-ink-soft">{notes || '—'}</p>
        )}
      </section>
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-ink-faint">{savedLine}</p>
    </div>
  )
}
