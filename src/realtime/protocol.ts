import type { Position, CharOp } from './convergence.exemple.ts'

export interface CursorState {
  position: number
  selectionStart: number
  selectionEnd: number
  anchors?: { position: Position | null; selectionStart: Position | null; selectionEnd: Position | null }
}

export interface Member extends CursorState {
  docId: string
  presenceId: string
  userId: string
  label: string
  color: string
}

export interface RoomSnapshot {
  docId: string
  text: string
  version: number
  selfId: string
  members: Member[]
  crdtOps: CharOp[]
  instance?: string
}

export type JoinAck = (ok: boolean, error?: string, snapshot?: RoomSnapshot) => void
export type OperationAck = (ok: boolean, error?: string) => void
