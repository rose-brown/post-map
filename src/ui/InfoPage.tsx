import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { TEMPLATES } from '../templates'
import {
  DEFAULT_RADII,
  RESERVED_PROPERTY_KEYS,
  uid,
  type Block,
  type BlockType,
  type PropertySchemaField,
} from '../types'
import { MarkerPicker } from './MarkerPicker'
import { PropertyRow } from './PropertyRow'
import { BlockList } from './Blocks'
import { geocoder } from '../providers/geocoding'

const BLOCK_TYPES: Array<{ type: BlockType; icon: string; name: string; desc: string }> = [
  { type: 'text', icon: '¶', name: '텍스트', desc: '자유롭게 메모' },
  { type: 'heading', icon: 'H', name: '제목', desc: '섹션 구분' },
  { type: 'todo', icon: '☑', name: '체크리스트', desc: '확인할 항목' },
  { type: 'gallery', icon: '◫', name: '사진 갤러리', desc: '여러 장 업로드' },
  { type: 'files', icon: '⎘', name: '파일', desc: 'PDF·이미지 첨부' },
  { type: 'callout', icon: '!', name: '콜아웃', desc: '강조할 메모' },
  { type: 'divider', icon: '—', name: '구분선', desc: '' },
]

type Menu = 'template' | 'prop' | 'block' | null

export function InfoPage({
  onClose,
  /** 바텀시트 안에서는 시트가 이미 제목과 닫기를 그리므로 자체 헤더를 생략한다. */
  embedded = false,
}: {
  onClose: () => void
  embedded?: boolean
}) {
  const selectedId = useStore((s) => s.selectedId)
  const feature = useStore((s) => s.features.find((f) => f.id === s.selectedId))
  const layer = useStore((s) => s.layers.find((l) => l.id === feature?.layerId))
  const addressHint = useStore((s) => (selectedId ? s.addressHints[selectedId] : undefined))
  const updateFeature = useStore((s) => s.updateFeature)
  const setProperty = useStore((s) => s.setProperty)
  const setBlocks = useStore((s) => s.setBlocks)
  const removeFeature = useStore((s) => s.removeFeature)
  const applyTemplate = useStore((s) => s.applyTemplate)
  const addSchemaField = useStore((s) => s.addSchemaField)

  const [menu, setMenu] = useState<Menu>(null)
  const [freeLabel, setFreeLabel] = useState('')

  if (!feature || !layer) return null

  const coords =
    feature.geometry.type === 'Point'
      ? (feature.geometry.coordinates as [number, number])
      : null

  /** 스키마 필드가 먼저, 그 다음 스키마 밖 자유 필드 (하이브리드 — PRD 4.1). */
  const schemaKeys = new Set(layer.schema.map((f) => f.key))
  const freeKeys = Object.keys(feature.properties).filter(
    (k) => !schemaKeys.has(k) && !RESERVED_PROPERTY_KEYS.has(k),
  )

  const addBlock = (type: BlockType) => {
    const block: Block = { id: uid('blk'), type }
    if (type === 'todo') block.items = [{ id: uid('itm'), text: '', done: false }]
    if (type === 'gallery' || type === 'files') block.refs = []
    if (type === 'text' || type === 'heading' || type === 'callout') block.text = ''
    setBlocks(feature.id, [...feature.blocks, block])
    setMenu(null)
  }

  const addFreeField = () => {
    const label = freeLabel.trim()
    if (!label) return
    setProperty(feature.id, label, '')
    // 빈 문자열은 저장되지 않으므로(PRD 4.3) 화면에 남기려면 공백 대신 자리표시 값을 넣는다.
    setProperty(feature.id, label, ' ')
    setFreeLabel('')
    setMenu(null)
  }

  const isEmpty = !layer.schema.length && !freeKeys.length && !feature.blocks.length

  return (
    <div className="flex h-full flex-col" data-testid="info-page">
      {!embedded && (
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
          <button
            onClick={onClose}
            className="touch-target -ml-1 rounded-lg px-1.5 py-1.5 text-[12px] font-semibold text-brand hover:bg-surface-sub"
            data-testid="back-to-list"
          >
            ← 목록
          </button>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-mut">{layer.name}</span>
          <button
            onClick={onClose}
            className="touch-target rounded-lg bg-surface-sub px-2.5 py-1.5 text-xs"
            aria-label="정보 페이지 닫기"
          >
            ✕
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {embedded && (
          <div className="mb-2 truncate text-[11px] text-ink-mut">{layer.name}</div>
        )}
        {/* 템플릿 */}
        <div className="relative mb-3">
          <button
            onClick={() => setMenu(menu === 'template' ? null : 'template')}
            className="rounded-lg bg-surface-sub px-2.5 py-1.5 text-[12px] font-medium text-ink-mut hover:bg-line-soft"
            data-testid="open-template-menu"
          >
            ◻ 템플릿 적용
          </button>
          {menu === 'template' && (
            <div className="absolute left-0 top-9 z-20 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
              <div className="px-2 pb-1 pt-1 text-[11px] text-ink-mut">
                템플릿 — 현재 페이지에 추가됩니다
              </div>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    applyTemplate(feature.id, t)
                    setMenu(null)
                  }}
                  className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left hover:bg-surface-sub"
                  data-testid="template-option"
                >
                  <span className="text-[13px] font-medium">{t.name}</span>
                  <span className="text-[11px] text-ink-mut">{t.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 제목 · 주소 · 좌표 */}
        <input
          value={feature.title}
          onChange={(e) => updateFeature(feature.id, { title: e.target.value })}
          placeholder="제목 없음"
          className="w-full bg-transparent py-1 text-[22px] font-bold tracking-tight"
          data-testid="feature-title"
        />
        <div className="mb-3 text-[11px] leading-relaxed text-ink-mut">
          {addressHint && (
            <div data-testid="address-hint">
              {addressHint}
              <span className="ml-1.5 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">
                저장 안 함 · {geocoder.id} 약관 미확인
              </span>
            </div>
          )}
          <div className="font-mono">
            {coords
              ? `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`
              : feature.geometry.type}
          </div>
        </div>

        {/* 표시 아이콘 · 동심원 — point 일 때만 */}
        {coords && (
          <MarkerPicker
            value={feature.properties.icon}
            onChange={(id) => setProperty(feature.id, 'icon', id)}
          />
        )}
        {coords && <RingEditor featureId={feature.id} />}

        {/* 속성 */}
        <div className="mt-3">
          {layer.schema.map((f) => (
            <PropertyRow
              key={f.key}
              field={f}
              value={feature.properties[f.key]}
              onChange={(v) => setProperty(feature.id, f.key, v)}
            />
          ))}
          {freeKeys.map((k) => (
            <PropertyRow
              key={k}
              field={{ key: k, label: k, type: 'text' } satisfies PropertySchemaField}
              value={feature.properties[k]}
              onChange={(v) => setProperty(feature.id, k, v)}
              onRemove={() => setProperty(feature.id, k, undefined)}
            />
          ))}
        </div>

        {/* 속성 추가 */}
        <div className="relative my-1.5">
          <button
            onClick={() => setMenu(menu === 'prop' ? null : 'prop')}
            className="px-2 py-1 text-[13px] text-ink-mut hover:text-brand"
            data-testid="open-prop-menu"
          >
            ＋ 속성 추가
          </button>
          {menu === 'prop' && (
            <div className="absolute left-0 top-8 z-20 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
              <div className="px-2 pb-1 pt-1 text-[11px] text-ink-mut">
                레이어 스키마에 추가 — 테이블·필터 대상이 됩니다
              </div>
              <div className="flex gap-1.5 px-1 pb-2">
                <input
                  value={freeLabel}
                  onChange={(e) => setFreeLabel(e.target.value)}
                  placeholder="필드 이름"
                  className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-[12px]"
                  data-testid="new-prop-label"
                />
                <button
                  onClick={() => {
                    const label = freeLabel.trim()
                    if (!label) return
                    addSchemaField(layer.id, {
                      key: `f_${label.replace(/\s+/g, '_').toLowerCase()}`,
                      label,
                      type: 'text',
                    })
                    setFreeLabel('')
                    setMenu(null)
                  }}
                  className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white"
                  data-testid="add-schema-prop"
                >
                  스키마에
                </button>
                <button
                  onClick={addFreeField}
                  className="rounded-md bg-surface-sub px-2 py-1 text-[11px] font-medium"
                  data-testid="add-free-prop"
                >
                  이 도형만
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 블록 */}
        <BlockList
          featureId={feature.id}
          blocks={feature.blocks}
          onChange={(b) => setBlocks(feature.id, b)}
        />

        {isEmpty && (
          <div className="px-2 py-1.5 text-[12px] text-ink-mut">
            빈 페이지입니다. 아래 ＋ 로 블록을, 위에서 속성이나 템플릿을 추가하세요.
          </div>
        )}

        {/* 블록 추가 */}
        <div className="relative mt-1.5">
          <button
            onClick={() => setMenu(menu === 'block' ? null : 'block')}
            className="px-2 py-1 text-[13px] text-ink-mut hover:text-brand"
            data-testid="open-block-menu"
          >
            ＋ 블록 추가
          </button>
          {menu === 'block' && (
            <div className="absolute left-0 top-8 z-20 w-72 rounded-xl border border-line bg-surface p-2 shadow-lg">
              {BLOCK_TYPES.map((b) => (
                <button
                  key={b.type}
                  onClick={() => addBlock(b.type)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-sub"
                  data-testid={`block-type-${b.type}`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-sub text-[12px] font-semibold text-ink-mut">
                    {b.icon}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium">{b.name}</span>
                    <span className="text-[11px] text-ink-mut">{b.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-line px-4 py-3">
        <button
          onClick={() => {
            removeFeature(feature.id)
            onClose()
          }}
          className="flex-1 text-left text-[13px] font-semibold text-danger"
          data-testid="delete-feature"
        >
          삭제
        </button>
        <button
          onClick={onClose}
          className="rounded-xl bg-brand px-6 py-2.5 text-[13px] font-semibold text-white"
        >
          완료
        </button>
      </div>
    </div>
  )
}

/** 동심원 반경 편집 — 기본 500 / 1000 / 2000m, 추가·삭제·수정 가능 (완료 기준 4). */
function RingEditor({ featureId }: { featureId: string }) {
  // 셀렉터 안에서 파생 배열을 만들면 매 렌더마다 새 참조가 나와 무한 루프가 난다.
  // 스토어에서는 안정적인 features 배열만 받고, 파생은 useMemo 로 한다.
  const features = useStore((s) => s.features)
  const setRings = useStore((s) => s.setRings)

  const radii = useMemo(
    () =>
      features
        .filter((f) => f.parentId === featureId && f.derivedFrom?.op === 'ring')
        .map((f) => Number(f.properties.radius))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b),
    [features, featureId],
  )
  const [draft, setDraft] = useState('')

  return (
    <div className="rounded-xl border border-line p-2.5" data-testid="ring-editor">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-semibold">동심원</span>
        <div className="flex-1" />
        {!radii.length ? (
          <button
            onClick={() => setRings(featureId, DEFAULT_RADII)}
            className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-white"
            data-testid="add-rings"
          >
            기본 반경 그리기
          </button>
        ) : (
          <button
            onClick={() => setRings(featureId, [])}
            className="rounded-md px-2 py-1 text-[11px] text-danger"
            data-testid="clear-rings"
          >
            모두 지우기
          </button>
        )}
      </div>

      {radii.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {radii.map((r) => (
            <span
              key={r}
              className="flex items-center gap-1 rounded-full bg-surface-sub px-2 py-1 text-[11px]"
              data-testid="ring-chip"
            >
              <input
                type="number"
                defaultValue={r}
                onBlur={(e) => {
                  const next = Number(e.target.value)
                  if (!Number.isFinite(next) || next <= 0) return
                  setRings(featureId, [...radii.filter((x) => x !== r), next])
                }}
                className="w-14 bg-transparent text-right"
              />
              m
              <button
                onClick={() => setRings(featureId, radii.filter((x) => x !== r))}
                className="text-ink-mut"
                aria-label={`${r}m 삭제`}
              >
                ✕
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const next = Number(draft)
              if (!Number.isFinite(next) || next <= 0) return
              setRings(featureId, [...radii, next])
              setDraft('')
            }}
            placeholder="＋ m"
            className="w-16 rounded-full bg-surface-sub px-2 py-1 text-[11px]"
            data-testid="new-radius"
          />
        </div>
      )}
    </div>
  )
}
