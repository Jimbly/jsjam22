/**
 * Error callback accepting an error as the first parameter and a result as the second parameter.
 * Both parameters are optional.
 *
 * @template T - The result type
 * @template E - The error type
 */
export interface ErrorCallback<T = never, E = unknown> {
/**
 * Error callback accepting an error as the first parameter and a result as the second parameter.
 * Both parameters are optional.
 *
 * @param err - The error parameter
 * @param result - The result parameter
 */
 (err?: E | undefined | null, result?: T extends (never | void) ? never : (T | undefined | null)): void;
}
