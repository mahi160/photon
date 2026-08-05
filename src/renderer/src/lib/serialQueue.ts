// Chains async work so calls settle in the order they were made, even when each one is fire-and-forget at
// the call site. Used wherever two async ops touch shared server/mpv state and must not land out of order
// (Jellyfin playback reporting: an old "stopped" racing a new "start"; mpv text-track add+select).
export function createSerialQueue(): (task: () => Promise<unknown>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve()
  return (task) => {
    const settled = tail.then(task).then(
      () => undefined,
      () => undefined
    )
    tail = settled
    return settled
  }
}
