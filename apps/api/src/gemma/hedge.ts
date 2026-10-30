export interface HedgeOptions {
  attempts: number;
  staggerMs: number;
  /** Errors that another attempt cannot fix, such as a bad request, fail immediately. */
  isFatal: (error: unknown) => boolean;
}

/**
 * Hosted Gemma randomly stalls or returns 500s, so waiting for one request is unreliable.
 * Starts a new attempt after each stagger, or as soon as one fails, and the first answer wins.
 */
export function hedge<T>(run: (signal: AbortSignal) => Promise<T>, options: HedgeOptions): Promise<T> {
  const { attempts, staggerMs, isFatal } = options;
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let started = 0;
    let failed = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (finish: () => void) => {
      settled = true;
      clearTimeout(timer);
      controller.abort();
      finish();
    };

    const start = () => {
      if (settled || started >= attempts) return;
      started += 1;
      clearTimeout(timer);
      timer = setTimeout(start, staggerMs);
      run(controller.signal).then(
        (value) => {
          if (!settled) settle(() => resolve(value));
        },
        (error: unknown) => {
          if (settled) return;
          failed += 1;
          if (isFatal(error) || failed >= attempts) settle(() => reject(error));
          else start();
        },
      );
    };

    start();
  });
}
