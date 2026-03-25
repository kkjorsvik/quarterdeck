export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  drain(): T[] {
    const items: T[] = [];
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity;
      items.push(this.buffer[idx] as T);
    }
    this.count = 0;
    this.head = 0;
    return items;
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }
}
