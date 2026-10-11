// Without onerror a worker that fails to load leaves the test waiting until its timeout.
export function workerResult<T>(worker: Worker): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    worker.onmessage = (event) => resolve(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      reject(new Error(`worker failed: ${event.message || 'load error'}`));
    };
    worker.onmessageerror = () => reject(new Error('worker message could not be deserialized'));
  });
}
