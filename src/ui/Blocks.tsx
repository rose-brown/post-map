import { useEffect, useRef, useState } from 'react'
import type { Block, BlobRef } from '../types'
import { uid } from '../types'
import { deleteBlob, getBlob, putBlob } from '../db/repo'

/**
 * 노션형 자유 블록 편집기.
 *
 * gallery·files 의 바이트는 IndexedDB 의 blobs 스토어에 Blob 으로 넣고 URL.createObjectURL 로 표시한다.
 * base64 data URL 로 저장하지 않는다 — 목업(.dc.html)이 readAsDataURL 을 쓴 것은 목업 한정이고,
 * 실제로 쓰면 IndexedDB 용량이 3~4배로 부푼다.
 */

export function useBlobUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let revoked = false
    let objectUrl: string | null = null

    getBlob(id).then((blob) => {
      if (!blob || revoked) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })

    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])

  return url
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / 1048576).toFixed(1)}MB`

export function BlockList({
  featureId,
  blocks,
  onChange,
}: {
  featureId: string
  blocks: Block[]
  onChange: (blocks: Block[]) => void
}) {
  // HTML5 drag-and-drop 은 터치에서 동작하지 않는다. 이 제품은 모바일 우선이므로(불변 규칙 7)
  // 포인터 이벤트로 직접 순서를 바꾼다. 마우스·터치·펜에서 모두 같은 코드가 돈다.
  const [dragging, setDragging] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const rowsRef = useRef<Array<HTMLDivElement | null>>([])

  const indexAt = (clientY: number): number | null => {
    for (let i = 0; i < rowsRef.current.length; i += 1) {
      const el = rowsRef.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (clientY >= r.top && clientY <= r.bottom) return i
    }
    return null
  }

  const patch = (i: number, p: Partial<Block>) =>
    onChange(blocks.map((b, j) => (i === j ? { ...b, ...p } : b)))

  const remove = (i: number) => {
    const block = blocks[i]
    block.refs?.forEach((r) => void deleteBlob(r.id))
    onChange(blocks.filter((_, j) => j !== i))
  }

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= blocks.length) return
    const next = [...blocks]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  return (
    <div data-testid="block-list">
      {blocks.map((block, i) => (
        <div
          key={block.id}
          ref={(el) => {
            rowsRef.current[i] = el
          }}
          className={`group flex items-start gap-1.5 py-0.5 ${
            dragging === i ? 'opacity-40' : ''
          } ${overIndex === i && dragging !== null && dragging !== i ? 'bg-brand-soft' : ''}`}
          data-testid="block"
          data-block-type={block.type}
        >
          <div
            className="w-5 shrink-0 cursor-grab touch-none select-none pt-2 text-center text-[11px] text-ink-mut"
            title="끌어서 순서 변경"
            data-testid="block-handle"
            onPointerDown={(e) => {
              e.preventDefault()
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              setDragging(i)
              setOverIndex(i)
            }}
            onPointerMove={(e) => {
              if (dragging === null) return
              setOverIndex(indexAt(e.clientY))
            }}
            onPointerUp={() => {
              if (dragging !== null && overIndex !== null) move(dragging, overIndex)
              setDragging(null)
              setOverIndex(null)
            }}
            onPointerCancel={() => {
              setDragging(null)
              setOverIndex(null)
            }}
          >
            ⠿
          </div>

          <div className="min-w-0 flex-1">
            <BlockBody
              featureId={featureId}
              block={block}
              onPatch={(p) => patch(i, p)}
            />
          </div>

          <button
            onClick={() => remove(i)}
            className="shrink-0 pt-2 text-[11px] text-ink-mut opacity-0 group-hover:opacity-100"
            aria-label="블록 삭제"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

function BlockBody({
  featureId,
  block,
  onPatch,
}: {
  featureId: string
  block: Block
  onPatch: (p: Partial<Block>) => void
}) {
  switch (block.type) {
    case 'heading':
      return (
        <input
          value={block.text ?? ''}
          onChange={(e) => onPatch({ text: e.target.value })}
          placeholder="제목"
          className="w-full bg-transparent py-1 text-[15px] font-bold"
        />
      )

    case 'text':
      return (
        <textarea
          value={block.text ?? ''}
          onChange={(e) => onPatch({ text: e.target.value })}
          placeholder="본 대로 적어두세요"
          rows={3}
          className="w-full bg-transparent py-1 text-[13px] leading-relaxed"
        />
      )

    case 'callout':
      return (
        <textarea
          value={block.text ?? ''}
          onChange={(e) => onPatch({ text: e.target.value })}
          placeholder="확인이 필요한 내용"
          rows={2}
          className="w-full rounded-r-lg border-l-[3px] border-warn bg-warn-soft px-3 py-2 text-[13px]"
        />
      )

    case 'divider':
      return <div className="my-2.5 h-px bg-line" />

    case 'todo':
      return (
        <div className="flex flex-col gap-1.5 py-1">
          {(block.items ?? []).map((item, j) => (
            <div key={item.id} className="flex items-center gap-2.5">
              <button
                onClick={() =>
                  onPatch({
                    items: (block.items ?? []).map((c, k) =>
                      k === j ? { ...c, done: !c.done } : c,
                    ),
                  })
                }
                className={`h-[18px] w-[18px] shrink-0 rounded text-[10px] font-bold text-white ${
                  item.done ? 'bg-brand' : 'border-[1.5px] border-line'
                }`}
                data-testid="todo-check"
                aria-pressed={item.done}
              >
                {item.done ? '✓' : ''}
              </button>
              <input
                value={item.text}
                onChange={(e) =>
                  onPatch({
                    items: (block.items ?? []).map((c, k) =>
                      k === j ? { ...c, text: e.target.value } : c,
                    ),
                  })
                }
                placeholder="확인할 항목"
                className={`min-w-0 flex-1 bg-transparent text-[13px] ${
                  item.done ? 'text-ink-mut line-through' : ''
                }`}
              />
              <button
                onClick={() =>
                  onPatch({ items: (block.items ?? []).filter((_, k) => k !== j) })
                }
                className="text-[11px] text-ink-mut"
                aria-label="항목 삭제"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onPatch({
                items: [...(block.items ?? []), { id: uid('itm'), text: '', done: false }],
              })
            }
            className="self-start text-[12px] font-medium text-brand"
          >
            ＋ 항목
          </button>
        </div>
      )

    case 'gallery':
      return <Gallery featureId={featureId} block={block} onPatch={onPatch} />

    case 'files':
      return <Files featureId={featureId} block={block} onPatch={onPatch} />
  }
}

async function storeFiles(featureId: string, files: File[]): Promise<BlobRef[]> {
  const refs: BlobRef[] = []
  for (const file of files) {
    const id = uid('blb')
    await putBlob({ id, featureId, blob: file })
    refs.push({ id, name: file.name, size: file.size, mime: file.type })
  }
  return refs
}

function Gallery({
  featureId,
  block,
  onPatch,
}: {
  featureId: string
  block: Block
  onPatch: (p: Partial<Block>) => void
}) {
  const refs = block.refs ?? []

  return (
    <div className="grid grid-cols-3 gap-2 py-1">
      {refs.map((ref) => (
        <Thumb
          key={ref.id}
          refItem={ref}
          onRemove={() => {
            void deleteBlob(ref.id)
            onPatch({ refs: refs.filter((r) => r.id !== ref.id) })
          }}
        />
      ))}
      <label className="flex aspect-[4/3] cursor-pointer items-center justify-center rounded-lg border border-dashed border-line text-[11px] text-ink-mut hover:border-brand hover:text-brand">
        ＋ 업로드
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          data-testid="gallery-input"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            if (!files.length) return
            const added = await storeFiles(featureId, files)
            onPatch({ refs: [...refs, ...added] })
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

function Thumb({ refItem, onRemove }: { refItem: BlobRef; onRemove: () => void }) {
  const url = useBlobUrl(refItem.id)
  return (
    <div
      className="relative aspect-[4/3] overflow-hidden rounded-lg bg-surface-sub bg-cover bg-center"
      style={url ? { backgroundImage: `url(${url})` } : undefined}
      data-testid="gallery-thumb"
    >
      <button
        onClick={onRemove}
        className="absolute right-1 top-1 h-5 w-5 rounded-full bg-black/60 text-[10px] font-bold text-white"
        aria-label="사진 삭제"
      >
        ✕
      </button>
    </div>
  )
}

function Files({
  featureId,
  block,
  onPatch,
}: {
  featureId: string
  block: Block
  onPatch: (p: Partial<Block>) => void
}) {
  const refs = block.refs ?? []

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {refs.map((ref) => {
        const ext = (ref.name.split('.').pop() ?? '').toUpperCase().slice(0, 3)
        return (
          <div
            key={ref.id}
            className="flex h-10 items-center gap-2.5 rounded-lg border border-line px-3"
            data-testid="file-row"
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[7px] font-bold ${
                ext === 'PDF' ? 'bg-danger text-white' : 'bg-surface-sub text-ink-mut'
              }`}
            >
              {ext}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px]">{ref.name}</span>
            <span className="shrink-0 text-[11px] text-ink-mut">{formatSize(ref.size)}</span>
            <button
              onClick={() => {
                void deleteBlob(ref.id)
                onPatch({ refs: refs.filter((r) => r.id !== ref.id) })
              }}
              className="text-[11px] text-ink-mut"
              aria-label="파일 삭제"
            >
              ✕
            </button>
          </div>
        )
      })}
      <label className="flex h-10 cursor-pointer items-center rounded-lg border border-dashed border-line px-3 text-[12px] text-ink-mut hover:border-brand">
        ＋ PDF·이미지 첨부
        <input
          type="file"
          multiple
          className="hidden"
          data-testid="files-input"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            if (!files.length) return
            const added = await storeFiles(featureId, files)
            onPatch({ refs: [...refs, ...added] })
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}
