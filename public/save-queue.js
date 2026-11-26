// Coalesce rapid clicks, but only send one request at a time for each cell.
// Confirmed state is separate from the optimistic desired state.
export class SaveQueue {
  constructor({ send, display, busy, failure, saved }) {
    Object.assign(this, { send, display, busy, failure, saved });
    this.cells = new Map();
    this.running = new Set();
    this.failures = new Map();
  }
  set(key, confirmed, desired, payload) {
    this.failures.delete(key);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { confirmed, desired, payload, revision: 0 };
      this.cells.set(key, cell);
    }
    cell.desired = desired;
    cell.payload = payload;
    cell.revision++;
    this.display(key, desired, true);
    if (!cell.promise) {
      // Schedule after storing the promise, including when send fails immediately.
      cell.promise = Promise.resolve().then(() => this.flush(key, cell));
      this.running.add(cell.promise);
      this.busy(true);
      cell.promise.finally(() => {
        this.running.delete(cell.promise);
        this.cells.delete(key);
        this.busy(this.running.size > 0);
      });
    }
  }
  async flush(key, cell) {
    while (true) {
      const desired = cell.desired;
      const payload = cell.payload;
      const revision = cell.revision;
      try {
        // Even if desired equals confirmed, send it: retrying an ambiguous network
        // failure must reassert the value, rather than assume the server rolled back.
        await this.send(payload, desired);
        cell.confirmed = desired;
      } catch (error) {
        if (cell.revision !== revision) continue;
        this.failures.set(key, { confirmed: cell.confirmed, desired, payload, error });
        this.display(key, cell.confirmed, false);
        this.failure(error, () => this.set(key, cell.confirmed, desired, payload));
        return;
      }
      if (cell.desired === cell.confirmed) {
        this.display(key, cell.confirmed, false);
        this.saved();
        return;
      }
    }
  }
  retryFailed() {
    for (const [key, { confirmed, desired, payload }] of [...this.failures]) {
      this.set(key, confirmed, desired, payload);
    }
    return this.idle();
  }
  reconcile() {
    this.failures.clear();
    this.busy(this.pending);
  }
  async idle() {
    while (this.running.size) await Promise.all([...this.running]);
  }
  get pending() { return this.running.size > 0; }
}
