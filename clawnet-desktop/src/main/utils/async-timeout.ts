export class TimeoutError extends Error {
  constructor(message = 'operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(label ? `${label}: timed out after ${ms}ms` : `timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
