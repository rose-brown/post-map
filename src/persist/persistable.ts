/**
 * 불변 규칙 1 — `canPersistResults`.
 *
 * 카카오 로컬 API처럼 "응답을 저장하지 마라"가 약관에 박힌 제공자가 있다. 이 제품은 지점·주소를
 * 영구 저장하는 것이 본체이므로, 저장이 불허인 제공자의 응답이 IndexedDB 로 흘러가면 제품이 위법해진다.
 *
 * 그래서 저장 경로는 `Persistable<T>` 만 받는다. `Persistable<T>` 를 만드는 길은 두 개뿐이다:
 *
 *   1. `userInput(v)`        — 사용자가 직접 입력하거나 직접 찍은 값. 언제나 사용자 소유 데이터다.
 *   2. `fromProvider(p, v)`  — `canPersistResults: true` 로 **타입에 박힌** 제공자의 값.
 *
 * (2) 의 `p` 는 `PersistingProvider` 여야 한다. `canPersistResults: false` 인 제공자를 넘기면
 * 런타임이 아니라 **컴파일이 깨진다**. src/providers/geocoding.ts 하단의 컴파일 타임 검증 참조.
 */

declare const PERSISTABLE: unique symbol

export type Persistable<T> = T & { readonly [PERSISTABLE]: true }

/** 저장 가능 여부를 타입에 박아 두는 제공자 표식. */
export interface ProviderPersistence<CanPersist extends boolean> {
  readonly id: string
  readonly canPersistResults: CanPersist
}

/** 저장이 허용된 제공자만 이 타입에 대입된다. */
export type PersistingProvider = ProviderPersistence<true>

/** 사용자가 직접 입력·선택·클릭한 값. 사용자 소유 데이터이므로 언제나 저장 가능하다. */
export function userInput<T>(value: T): Persistable<T> {
  return value as Persistable<T>
}

/**
 * 제공자 응답을 저장 경로로 들여보낸다.
 * `canPersistResults: false` 인 제공자를 넘기면 타입 에러가 난다.
 */
export function fromProvider<T>(_provider: PersistingProvider, value: T): Persistable<T> {
  return value as Persistable<T>
}

/** 저장하지 않고 화면에만 쓰는 값임을 명시한다. 저장 경로에 넣을 수 없다. */
export type DisplayOnly<T> = T & { readonly __displayOnly?: true }

export function displayOnly<T>(value: T): DisplayOnly<T> {
  return value as DisplayOnly<T>
}
