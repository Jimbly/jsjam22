declare module 'glov/common/global' {
  global {

    /**
     * From: https://www.typescriptlang.org/docs/handbook/mixins.html
     * A constructor for a type which extends T
     * Note: `typeof T` is usually a better choice (doesn't lose static methods)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
    type Constructor<T = {}> = new (...args: any[]) => T;

  }
}
