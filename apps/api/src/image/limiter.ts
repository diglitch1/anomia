/** Minimal FIFO semaphore so only a few images are decoded at once. */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      // Hand the slot straight to the next task; only free it when nobody waits.
      if (next) next();
      else this.active--;
    }
  }
}
