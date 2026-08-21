import type { Todo } from "@opencode-ai/sdk"
import type { RecallResult } from "../recall/engine"

export interface WriteSummary {
  readonly outcome: string
  readonly id?: string
}

export interface SessionMemoryState {
  recall?: RecallResult
  readonly todos: Todo[]
  readonly currentFiles: string[]
  readonly recentTopics: string[]
  readonly lastWrites: WriteSummary[]
}

export class SessionState {
  private readonly sessions = new Map<string, SessionMemoryState>()
  private readonly recentFiles: string[] = []

  get(sessionId: string): SessionMemoryState {
    return this.ensure(sessionId)
  }

  setRecall(sessionId: string, recall: RecallResult): void {
    this.ensure(sessionId).recall = recall
  }

  consumeRecall(sessionId: string): RecallResult | undefined {
    const state = this.sessions.get(sessionId)
    const recall = state?.recall
    if (state) delete state.recall
    return recall
  }

  setTodos(sessionId: string, todos: readonly Todo[]): void {
    this.ensure(sessionId).todos.splice(0, Number.POSITIVE_INFINITY, ...todos)
  }

  addCurrentFile(sessionId: string, file: string): void {
    const files = this.ensure(sessionId).currentFiles
    if (!files.includes(file)) files.push(file)
  }

  addCurrentFileToAll(file: string): void {
    if (!this.recentFiles.includes(file)) this.recentFiles.push(file)
    if (this.recentFiles.length > 20) this.recentFiles.shift()
    for (const sessionId of this.sessions.keys()) this.addCurrentFile(sessionId, file)
  }

  addRecentTopic(sessionId: string, topic: string): void {
    const topics = this.ensure(sessionId).recentTopics
    if (!topics.includes(topic)) topics.push(topic)
    if (topics.length > 10) topics.shift()
  }

  recordWrite(sessionId: string, write: WriteSummary): void {
    const writes = this.ensure(sessionId).lastWrites
    writes.push(write)
    if (writes.length > 20) writes.shift()
  }

  cleanup(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  private ensure(sessionId: string): SessionMemoryState {
    const current = this.sessions.get(sessionId)
    if (current) return current
    const created = createState(this.recentFiles)
    this.sessions.set(sessionId, created)
    return created
  }
}

function createState(currentFiles: readonly string[] = []): SessionMemoryState {
  return { todos: [], currentFiles: [...currentFiles], recentTopics: [], lastWrites: [] }
}
