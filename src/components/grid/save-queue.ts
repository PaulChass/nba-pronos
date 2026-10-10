// Strictly sequential runner for the grid editor's saves (no React, no Next, so it can be
// unit-tested with `node --test`). One task at a time: each save is sent with the version the
// previous one returned, so two requests never carry the same expected version.

export interface SerialQueue {
  /** Tasks queued or running. */
  readonly size: number
  /** Runs `task` once every earlier task has settled. A failing task does not stop the queue. */
  push(task: () => unknown): Promise<void>
  /** Resolves once every task queued so far has settled. */
  idle(): Promise<void>
}

export interface SerialQueueOptions {
  /** Called with the new size whenever a task is queued or settles. */
  onSizeChange?(size: number): void
  /** A task that throws: reported here, then the next task runs. */
  onError?(error: unknown): void
}

export function createSerialQueue({ onSizeChange, onError }: SerialQueueOptions = {}): SerialQueue {
  let tail: Promise<void> = Promise.resolve()
  let size = 0
  const resize = (delta: number) => {
    size += delta
    onSizeChange?.(size)
  }
  return {
    get size() {
      return size
    },
    push(task) {
      resize(1)
      tail = tail
        .then(() => task())
        .then(
          () => undefined,
          (error: unknown) => onError?.(error),
        )
        .finally(() => resize(-1))
      return tail
    },
    idle() {
      return tail
    },
  }
}
