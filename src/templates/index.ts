import type { BlockType, PropertySchemaField } from '../types'

/**
 * 불변 규칙 6 — 도메인 용어를 코드에 박지 않는다.
 *
 * 매물·단지·임장·점검 같은 말은 **이 데이터 파일 안에서만** 존재한다.
 * 코드는 템플릿을 이름으로 분기하지 않고, 아래 구조만 보고 속성·블록을 붙인다.
 * 새 도메인을 지원하려면 이 배열에 항목을 추가하면 되고 코드는 건드리지 않는다.
 */

export interface TemplateBlock {
  type: BlockType
  text?: string
  items?: string[]
}

export interface Template {
  id: string
  name: string
  description: string
  /** 레이어 스키마에 합쳐질 필드 */
  fields: PropertySchemaField[]
  /** 피처에 추가될 블록 프리셋 */
  blocks: TemplateBlock[]
}

export const TEMPLATES: Template[] = [
  {
    id: 'field-survey',
    name: '현장 조사 기본',
    description: '사진 + 체크리스트 + 메모',
    fields: [
      { key: 'visitedAt', label: '방문일', type: 'date' },
      { key: 'condition', label: '상태', type: 'select', options: ['양호', '보통', '불량'] },
      { key: 'area', label: '면적', type: 'number', unit: '㎡' },
    ],
    blocks: [
      { type: 'heading', text: '첫인상' },
      { type: 'text', text: '' },
      { type: 'todo', items: ['채광·향', '소음', '주차', '누수 흔적'] },
      { type: 'gallery' },
    ],
  },
  {
    id: 'facility-inspection',
    name: '시설물 점검',
    description: '설치일·상태·담당자 + 점검 체크리스트 + 파일',
    fields: [
      { key: 'installedAt', label: '설치일', type: 'date' },
      { key: 'status', label: '점검 상태', type: 'select', options: ['정상', '주의', '고장'] },
      { key: 'manager', label: '담당자', type: 'text' },
      { key: 'contact', label: '연락처', type: 'phone' },
    ],
    blocks: [
      { type: 'heading', text: '점검 항목' },
      { type: 'todo', items: ['외관 손상', '고정 상태', '전원·배선', '라벨 부착'] },
      { type: 'files' },
      { type: 'callout', text: '이상 발견 시 담당자에게 즉시 공유' },
    ],
  },
  {
    id: 'simple-note',
    name: '단순 메모',
    description: '텍스트 하나',
    fields: [],
    blocks: [{ type: 'text', text: '' }],
  },
]
