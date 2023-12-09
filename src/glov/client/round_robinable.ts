import assert from 'assert';

export const ROUNDROBIN_NO = 0;
export const ROUNDROBIN_START = 1;
export const ROUNDROBIN_CONTINUE = 2;
export type RoundRobinState = typeof ROUNDROBIN_NO | typeof ROUNDROBIN_START | typeof ROUNDROBIN_CONTINUE;

export type RoundRobinableItem = {
  roundrobinable_next?: RoundRobinableItem | null; // if null or defined it's in the list; undefined it's not
};

export type RoundRobinable = RoundRobinableImpl;
class RoundRobinableImpl {
  private head: RoundRobinableItem | null;
  private tail: RoundRobinableItem | null;
  private continuer_this: RoundRobinableItem | null;
  private continuer_next: RoundRobinableItem | null;
  constructor() {
    this.head = this.tail = null;
    this.continuer_this = null;
    this.continuer_next = null;
  }

  // Returns START for at most one item per frame
  // Returns CONTINUE for the previous frame's item if it was stillWorking()
  query(thing: RoundRobinableItem): RoundRobinState {
    if (thing.roundrobinable_next === undefined) {
      if (this.tail) {
        this.tail.roundrobinable_next = thing;
        this.tail = thing;
      } else {
        this.head = this.tail = thing;
      }
      thing.roundrobinable_next = null;
    }
    if (this.head === thing) {
      if (this.continuer_this === thing) {
        return ROUNDROBIN_CONTINUE;
      } else {
        return ROUNDROBIN_START;
      }
    }
    return ROUNDROBIN_NO;
  }

  // After receiving a START or CONTINUE, call this to ensure we receive
  // a CONTINUE next frame instead of someone else STARTing.
  stillWorking(thing: RoundRobinableItem): void {
    assert.equal(this.head, thing);
    this.continuer_next = thing;
  }

  // At any time, bump this thing so it will be the next up (after any in-progress
  // element is done)
  bump(thing: RoundRobinableItem): void {
    if (this.head === thing || this.head && this.head.roundrobinable_next === thing) {
      // already in front two spots
      return;
    }
    if (thing.roundrobinable_next !== undefined) {
      // remove from where it is; asserts if it's not found
      assert(this.head);
      let walk: RoundRobinableItem = this.head;
      assert(walk.roundrobinable_next);
      let next: RoundRobinableItem = walk.roundrobinable_next;
      while (next !== thing) {
        walk = next;
        assert(walk.roundrobinable_next);
        next = walk.roundrobinable_next;
      }
      walk.roundrobinable_next = thing.roundrobinable_next;
      thing.roundrobinable_next = undefined;
      if (this.tail === thing) {
        this.tail = walk;
      }
    }
    if (!this.head) {
      this.head = this.tail = thing;
      thing.roundrobinable_next = null;
      return;
    }
    // insert after current head (which may be in progress, or may have already went and will be cleared in tick())
    thing.roundrobinable_next = this.head.roundrobinable_next;
    this.head.roundrobinable_next = thing;
    if (!thing.roundrobinable_next) {
      this.tail = thing;
    }
  }

  tick(): void {
    let head: RoundRobinableItem | null = this.head;
    if (head) {
      if (head !== this.continuer_next) {
        // remove head and advance
        let next = head.roundrobinable_next;
        head.roundrobinable_next = undefined;
        assert(next !== undefined);
        head = next;
      }

      this.head = head;
      if (!head) {
        this.tail = null;
      }
    }
    this.continuer_this = this.continuer_next;
    this.continuer_next = null;
  }
}

export function roundRobinableCreate(): RoundRobinable {
  return new RoundRobinableImpl();
}
