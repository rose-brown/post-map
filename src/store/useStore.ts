import { create } from 'zustand'
import type { Geometry, Point } from 'geojson'
import {
  DEFAULT_RADII,
  SCHEMA_VERSION,
  nowIso,
  uid,
  type Block,
  type Feature,
  type Layer,
  type Project,
  type Properties,
  type PropertySchemaField,
} from '../types'
import { userInput } from '../persist/persistable'
import {
  deleteFeatures,
  deleteLayer,
  flush,
  loadAll,
  saveFeature,
  saveFeatures,
  saveLayer,
  saveProject,
  firstProjectId,
} from '../db/repo'
import { runMigrations } from '../db/db'
import { buildRings } from '../map/rings'
import type { Template } from '../templates'

export type DrawMode =
  | 'select'
  | 'point'
  | 'linestring'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'delete'

const PALETTE = ['#2563eb', '#db2777', '#15803d', '#b45309', '#7c3aed', '#0891b2']

function newLayer(projectId: string, order: number, name?: string): Layer {
  return {
    id: uid('lyr'),
    projectId,
    name: name ?? `레이어 ${order + 1}`,
    kind: 'vector',
    visible: true,
    order,
    style: {
      color: PALETTE[order % PALETTE.length],
      opacity: 0.25,
      strokeWidth: 2,
      pointRadius: 6,
    },
    schema: [],
    locked: false,
  }
}

interface State {
  ready: boolean
  project: Project | null
  layers: Layer[]
  features: Feature[]
  activeLayerId: string | null
  selectedId: string | null
  drawMode: DrawMode
  basemapId: string
  /** 저장되지 않는 표시 전용 주소. 제공자 약관 미확인이라 저장 경로로 보내지 않는다. */
  addressHints: Record<string, string>

  init(): Promise<void>
  setDrawMode(m: DrawMode): void
  setBasemap(id: string): void
  select(id: string | null): void

  addLayer(name?: string): void
  updateLayer(id: string, patch: Partial<Layer>): void
  removeLayer(id: string): void
  setActiveLayer(id: string): void
  reorderLayer(id: string, dir: -1 | 1): void
  addSchemaField(layerId: string, field: PropertySchemaField): void
  removeSchemaField(layerId: string, key: string): void
  updateSchemaField(layerId: string, key: string, patch: Partial<PropertySchemaField>): void

  addFeatureFromGeometry(geometry: Geometry, layerId?: string): string
  /** Terra Draw 가 만든 id 를 그대로 쓴다 — 작도 도형은 TD 가 id 를 소유한다. */
  addFeatureFromGeometryWithId(id: string, geometry: Geometry, layerId: string): boolean
  updateFeature(id: string, patch: Partial<Feature>): void
  setProperty(id: string, key: string, value: Properties[string] | undefined): void
  setBlocks(id: string, blocks: Block[]): void
  removeFeature(id: string): void
  applyTemplate(featureId: string, template: Template): void

  setRings(centerId: string, radii: number[]): void
  ringRadii(centerId: string): number[]
  setAddressHint(id: string, address: string): void
}

/**
 * init() 은 동시에 두 번 불릴 수 있다 (React StrictMode 의 이중 마운트, 라우팅 재진입 등).
 * 가드가 없으면 양쪽이 "프로젝트 없음"을 보고 각자 프로젝트를 만들어, 도형이 들어간 프로젝트와
 * 화면이 로드한 프로젝트가 갈린다. 실제로 그렇게 깨졌다. 약속 하나로 직렬화한다.
 */
let initPromise: Promise<void> | null = null

export const useStore = create<State>((set, get) => ({
  ready: false,
  project: null,
  layers: [],
  features: [],
  activeLayerId: null,
  selectedId: null,
  drawMode: 'select',
  basemapId: 'Base',
  addressHints: {},

  async init() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      await runMigrations()
      const id = await firstProjectId()

      if (!id) {
        const project: Project = {
          id: uid('prj'),
          name: '새 프로젝트',
          description: '',
          initialView: { lng: 126.978, lat: 37.5665, zoom: 12, bearing: 0, pitch: 0 },
          schemaVersion: SCHEMA_VERSION,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        const layer = newLayer(project.id, 0, '기본 레이어')
        saveProject(userInput(project))
        saveLayer(userInput(layer))
        await flush()
        set({
          ready: true,
          project,
          layers: [layer],
          features: [],
          activeLayerId: layer.id,
        })
        return
      }

      const { project, layers, features } = await loadAll(id)
      if (!project) {
        set({ ready: true })
        return
      }
      const ensured = layers.length ? layers : [newLayer(project.id, 0, '기본 레이어')]
      if (!layers.length) saveLayer(userInput(ensured[0]))
      set({
        ready: true,
        project,
        layers: ensured,
        features,
        activeLayerId: ensured[0].id,
      })
    })()
    return initPromise
  },

  setDrawMode: (drawMode) => set({ drawMode }),
  setBasemap: (basemapId) => set({ basemapId }),
  select: (selectedId) => set({ selectedId }),

  addLayer(name) {
    const { project, layers } = get()
    if (!project) return
    const layer = newLayer(project.id, layers.length, name)
    saveLayer(userInput(layer))
    set({ layers: [...layers, layer], activeLayerId: layer.id })
  },

  updateLayer(id, patch) {
    const layers = get().layers.map((l) => (l.id === id ? { ...l, ...patch } : l))
    const changed = layers.find((l) => l.id === id)
    if (changed) saveLayer(userInput(changed))
    set({ layers })
  },

  removeLayer(id) {
    const { layers, features, activeLayerId } = get()
    if (layers.length <= 1) return
    deleteLayer(id)
    const rest = layers.filter((l) => l.id !== id)
    set({
      layers: rest,
      features: features.filter((f) => f.layerId !== id),
      activeLayerId: activeLayerId === id ? rest[0].id : activeLayerId,
      selectedId: null,
    })
  },

  setActiveLayer: (activeLayerId) => set({ activeLayerId }),

  reorderLayer(id, dir) {
    const layers = [...get().layers]
    const i = layers.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= layers.length) return
    ;[layers[i], layers[j]] = [layers[j], layers[i]]
    const renumbered = layers.map((l, idx) => ({ ...l, order: idx }))
    renumbered.forEach((l) => saveLayer(userInput(l)))
    set({ layers: renumbered })
  },

  addSchemaField(layerId, field) {
    const layer = get().layers.find((l) => l.id === layerId)
    if (!layer || layer.schema.some((f) => f.key === field.key)) return
    get().updateLayer(layerId, { schema: [...layer.schema, field] })
  },

  removeSchemaField(layerId, key) {
    const layer = get().layers.find((l) => l.id === layerId)
    if (!layer) return
    get().updateLayer(layerId, { schema: layer.schema.filter((f) => f.key !== key) })
  },

  updateSchemaField(layerId, key, patch) {
    const layer = get().layers.find((l) => l.id === layerId)
    if (!layer) return
    get().updateLayer(layerId, {
      schema: layer.schema.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    })
  },

  addFeatureFromGeometry(geometry, layerId) {
    const { activeLayerId, features } = get()
    const target = layerId ?? activeLayerId
    if (!target) return ''
    const feature: Feature = {
      id: uid('ftr'),
      layerId: target,
      geometry,
      title: '',
      properties: {},
      blocks: [],
      parentId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    // 사용자가 직접 찍은 도형이므로 사용자 소유 데이터다.
    saveFeature(userInput(feature))
    set({ features: [...features, feature] })
    return feature.id
  },

  addFeatureFromGeometryWithId(id, geometry, layerId) {
    const { features } = get()
    if (features.some((f) => f.id === id)) return false
    const feature: Feature = {
      id,
      layerId,
      geometry,
      title: '',
      properties: {},
      blocks: [],
      parentId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    saveFeature(userInput(feature))
    set({ features: [...features, feature] })
    return true
  },

  updateFeature(id, patch) {
    const features = get().features.map((f) =>
      f.id === id ? { ...f, ...patch, updatedAt: nowIso() } : f,
    )
    const changed = features.find((f) => f.id === id)
    if (changed) saveFeature(userInput(changed))
    set({ features })
  },

  setProperty(id, key, value) {
    const feature = get().features.find((f) => f.id === id)
    if (!feature) return
    const properties = { ...feature.properties }
    // 값이 없으면 키를 저장하지 않는다 (PRD 4.3).
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
      delete properties[key]
    } else {
      properties[key] = value
    }
    get().updateFeature(id, { properties })
  },

  setBlocks(id, blocks) {
    get().updateFeature(id, { blocks })
  },

  removeFeature(id) {
    const { features } = get()
    // 동심원 링은 중심 point 를 참조한다. 부모를 지우면 같이 지운다 (cascade).
    const cascade = features.filter((f) => f.id === id || f.parentId === id).map((f) => f.id)
    deleteFeatures(cascade)
    set({
      features: features.filter((f) => !cascade.includes(f.id)),
      selectedId: null,
    })
  },

  applyTemplate(featureId, template) {
    const { features, layers } = get()
    const feature = features.find((f) => f.id === featureId)
    if (!feature) return

    // 템플릿 필드는 레이어 스키마에 합친다 (이미 있는 key 는 건너뛴다).
    const layer = layers.find((l) => l.id === feature.layerId)
    if (layer) {
      const existing = new Set(layer.schema.map((f) => f.key))
      const merged = [...layer.schema, ...template.fields.filter((f) => !existing.has(f.key))]
      if (merged.length !== layer.schema.length) {
        get().updateLayer(layer.id, { schema: merged })
      }
    }

    const blocks: Block[] = template.blocks.map((b) => ({
      id: uid('blk'),
      type: b.type,
      ...(b.text !== undefined ? { text: b.text } : {}),
      ...(b.items
        ? { items: b.items.map((t) => ({ id: uid('itm'), text: t, done: false })) }
        : {}),
      ...(b.type === 'gallery' || b.type === 'files' ? { refs: [] } : {}),
    }))

    get().updateFeature(featureId, { blocks: [...feature.blocks, ...blocks] })
  },

  ringRadii(centerId) {
    const rings = get().features.filter((f) => f.parentId === centerId && f.derivedFrom?.op === 'ring')
    if (!rings.length) return []
    return rings
      .map((r) => Number(r.properties.radius))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
  },

  setRings(centerId, radii) {
    const { features } = get()
    const center = features.find((f) => f.id === centerId)
    if (!center || center.geometry.type !== 'Point') return

    const old = features.filter((f) => f.parentId === centerId && f.derivedFrom?.op === 'ring')
    if (old.length) deleteFeatures(old.map((f) => f.id))

    const coords = (center.geometry as Point).coordinates as [number, number]
    const created = buildRings(coords, radii).map<Feature>((ring) => ({
      id: uid('rng'),
      layerId: center.layerId,
      geometry: ring.geometry,
      title: ring.label,
      properties: { radius: ring.radius, label: ring.label },
      blocks: [],
      derivedFrom: { op: 'ring', sourceIds: [centerId], params: { radius: ring.radius } },
      parentId: centerId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }))

    // 반경은 사용자가 입력한 값, 중심은 사용자가 찍은 점이므로 사용자 소유 데이터다.
    saveFeatures(created.map((f) => userInput(f)))
    set({
      features: [...features.filter((f) => !old.some((o) => o.id === f.id)), ...created],
    })
  },

  setAddressHint(id, address) {
    set({ addressHints: { ...get().addressHints, [id]: address } })
  },
}))

export const DEFAULT_RING_RADII = DEFAULT_RADII
