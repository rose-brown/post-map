import { useState } from 'react'
import { useStore } from '../store/useStore'
import type { PropertySchemaField, PropertyType } from '../types'

const TYPES: PropertyType[] = [
  'text',
  'number',
  'date',
  'select',
  'multiselect',
  'boolean',
  'url',
  'phone',
]

const PALETTE = ['#2563eb', '#db2777', '#15803d', '#b45309', '#7c3aed', '#0891b2']

export function LayerPanel() {
  const layers = useStore((s) => s.layers)
  const features = useStore((s) => s.features)
  const activeLayerId = useStore((s) => s.activeLayerId)
  const setActiveLayer = useStore((s) => s.setActiveLayer)
  const addLayer = useStore((s) => s.addLayer)
  const updateLayer = useStore((s) => s.updateLayer)
  const removeLayer = useStore((s) => s.removeLayer)
  const reorderLayer = useStore((s) => s.reorderLayer)

  const [schemaFor, setSchemaFor] = useState<string | null>(null)

  const count = (layerId: string) =>
    features.filter((f) => f.layerId === layerId && !f.derivedFrom).length

  return (
    <div className="flex h-full flex-col" data-testid="layer-panel">
      <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-sm font-semibold">레이어</span>
        <span className="text-xs text-ink-mut">{layers.length}</span>
        <div className="flex-1" />
        <button
          onClick={() => addLayer()}
          className="rounded-lg bg-surface-sub px-2.5 py-1.5 text-xs font-medium hover:bg-line-soft"
          data-testid="add-layer"
        >
          ＋ 레이어
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {layers.map((layer, i) => (
          <div
            key={layer.id}
            className={`mb-1.5 rounded-xl border p-2.5 ${
              layer.id === activeLayerId ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
            }`}
            data-testid="layer-row"
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
                title={layer.visible ? '숨기기' : '보이기'}
                aria-pressed={layer.visible}
                className="touch-target w-7 shrink-0 text-center text-sm"
                data-testid="toggle-visible"
              >
                {layer.visible ? '◉' : '○'}
              </button>

              <input
                value={layer.name}
                onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                onFocus={() => setActiveLayer(layer.id)}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium"
                data-testid="layer-name"
              />

              <span className="shrink-0 text-[11px] text-ink-mut">{count(layer.id)}</span>

              <button
                onClick={() => reorderLayer(layer.id, -1)}
                disabled={i === 0}
                className="px-1 text-xs text-ink-mut disabled:opacity-30"
                aria-label="위로"
              >
                ▲
              </button>
              <button
                onClick={() => reorderLayer(layer.id, 1)}
                disabled={i === layers.length - 1}
                className="px-1 text-xs text-ink-mut disabled:opacity-30"
                aria-label="아래로"
              >
                ▼
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => updateLayer(layer.id, { style: { ...layer.style, color: c } })}
                  className={`h-4 w-4 rounded-full ring-offset-1 ${
                    layer.style.color === c ? 'ring-2 ring-ink' : ''
                  }`}
                  style={{ background: c }}
                  aria-label={`색상 ${c}`}
                />
              ))}
              <div className="flex-1" />
              <button
                onClick={() => setSchemaFor(schemaFor === layer.id ? null : layer.id)}
                className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] text-ink-mut hover:bg-surface-sub"
                data-testid="open-schema"
              >
                속성 스키마 {layer.schema.length > 0 && `(${layer.schema.length})`}
              </button>
              <button
                onClick={() => removeLayer(layer.id)}
                disabled={layers.length <= 1}
                className="shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] text-danger disabled:opacity-30"
              >
                삭제
              </button>
            </div>

            {schemaFor === layer.id && <SchemaEditor layerId={layer.id} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function SchemaEditor({ layerId }: { layerId: string }) {
  const layer = useStore((s) => s.layers.find((l) => l.id === layerId))
  const addSchemaField = useStore((s) => s.addSchemaField)
  const removeSchemaField = useStore((s) => s.removeSchemaField)
  const updateSchemaField = useStore((s) => s.updateSchemaField)

  const [label, setLabel] = useState('')
  const [type, setType] = useState<PropertyType>('text')

  if (!layer) return null

  const add = () => {
    const trimmed = label.trim()
    if (!trimmed) return
    const key = `f_${trimmed.replace(/\s+/g, '_').toLowerCase()}_${Math.random().toString(36).slice(2, 5)}`
    const field: PropertySchemaField = { key, label: trimmed, type }
    if (type === 'select' || type === 'multiselect') field.options = ['선택지 1', '선택지 2']
    addSchemaField(layerId, field)
    setLabel('')
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface p-2" data-testid="schema-editor">
      {layer.schema.map((f) => (
        <div key={f.key} className="mb-1 flex items-center gap-1.5">
          <input
            value={f.label}
            onChange={(e) => updateSchemaField(layerId, f.key, { label: e.target.value })}
            className="min-w-0 flex-1 rounded border border-line px-1.5 py-1 text-[12px]"
          />
          <select
            value={f.type}
            onChange={(e) =>
              updateSchemaField(layerId, f.key, { type: e.target.value as PropertyType })
            }
            className="rounded border border-line px-1 py-1 text-[11px]"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            value={f.unit ?? ''}
            placeholder="단위"
            onChange={(e) => updateSchemaField(layerId, f.key, { unit: e.target.value })}
            className="w-14 rounded border border-line px-1.5 py-1 text-[11px]"
          />
          <button
            onClick={() => removeSchemaField(layerId, f.key)}
            className="px-1 text-[11px] text-ink-mut"
            aria-label="필드 삭제"
          >
            ✕
          </button>
        </div>
      ))}

      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="새 필드 이름"
          className="min-w-0 flex-1 rounded border border-line px-1.5 py-1 text-[12px]"
          data-testid="new-field-label"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PropertyType)}
          className="rounded border border-line px-1 py-1 text-[11px]"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={add}
          className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white"
          data-testid="add-field"
        >
          추가
        </button>
      </div>
    </div>
  )
}
