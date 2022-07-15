// FIFO queue implemented as a doubly-linked list (e.g. allows removal of any element)

import assert from 'assert';

let last_queue_id = 0;

type FIFONode<T> = Partial<Record<string, T>>;

class FIFOImpl<T> {
  private head: T | null = null;
  private tail: T | null = null;
  private count = 0;
  private nkey = `n${++last_queue_id}`;
  private pkey = `p${last_queue_id}`;

  length(): number {
    return this.count;
  }
  size(): number {
    return this.count;
  }

  add(item: T): void {
    let node = item as FIFONode<T>;
    assert(!node[this.nkey]);
    assert(!node[this.pkey]);
    if (this.tail) {
      node[this.pkey] = this.tail;
    }
    if (this.tail) {
      (this.tail as FIFONode<T>)[this.nkey] = item;
      this.tail = item;
    } else {
      this.head = this.tail = item;
    }
    ++this.count;
  }

  remove(item: T): void {
    let node = item as FIFONode<T>;
    let prev = node[this.pkey];
    let next = node[this.nkey];
    if (prev) {
      (prev as FIFONode<T>)[this.nkey] = next;
      delete node[this.pkey];
    } else {
      assert.equal(this.head, item);
      assert(item !== next);
      this.head = next || null;
    }
    if (next) {
      (next as FIFONode<T>)[this.pkey] = prev;
      delete node[this.nkey];
    } else {
      assert.equal(this.tail, item);
      this.tail = prev || null;
    }
    --this.count;
  }

  contains(item: T): boolean {
    return this.head === item || (item as FIFONode<T>)[this.pkey] !== undefined;
  }

  peek(): T | null {
    return this.head;
  }

  pop(): T | null {
    if (!this.count) {
      return null;
    }
    assert(this.head);
    let head = this.head;
    this.remove(head);
    return head;
  }
}
export type FIFO<T> = FIFOImpl<T>;

export function fifoCreate<T>(): FIFO<T> {
  return new FIFOImpl();
}
