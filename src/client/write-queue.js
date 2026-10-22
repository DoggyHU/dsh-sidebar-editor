/**
 * One write queue per file address, shared by both views of this plugin.
 *
 * A tab can be switched from the rich text view to the code view, and that is an
 * unmount plus a mount inside one commit: the outgoing body's last write and the
 * incoming body's first read are issued from the same task, on two different
 * browser connections. The host half serialises the requests it *receives*, which is
 * not the same thing as the order they were *issued* — a read issued first stays
 * first even if a write was queued behind it.
 *
 * Both bodies live in one bundle, so a module-level map is enough to make the
 * ordering explicit: every write is queued here, and every read waits for the
 * address to go idle first. `address` is the key, so unrelated files never wait.
 */

/** Tail promise per address; absent means idle. */
const chains = new Map();

/**
 * Queue one task behind the address's previous task.
 * @param address - the file address (empty string is a valid, isolated key).
 * @param task - the work; called with no arguments.
 * @returns the task's own promise.
 */
export function enqueueWrite(address, task) {
  const key = typeof address === 'string' ? address : '';
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const guarded = run.catch(() => {});
  chains.set(key, guarded);
  void guarded.then(() => {
    if (chains.get(key) === guarded) chains.delete(key);
  });
  return run;
}

/**
 * Resolve once nothing is queued for this address.
 *
 * Reads call this before asking the host, so "the write that happened on the way
 * out" has been asked for before "the read that follows" is.
 * @param address - the file address.
 * @returns a promise that never rejects.
 */
export function whenIdle(address) {
  const key = typeof address === 'string' ? address : '';
  return chains.get(key) ?? Promise.resolve();
}
