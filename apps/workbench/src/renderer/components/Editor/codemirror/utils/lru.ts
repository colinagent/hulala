export class LRUCache<V> {
  private map = new Map<string, V>();

  constructor(private maxSize: number) {}

  getOrCreate(key: string, create: () => V): V {
    const existing = this.map.get(key);
    if (existing !== undefined) {
      // Refresh LRU order
      this.map.delete(key);
      this.map.set(key, existing);
      return existing;
    }

    const value = create();
    this.map.set(key, value);

    if (this.map.size > this.maxSize) {
      const oldestKey = this.map.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    return value;
  }
}
