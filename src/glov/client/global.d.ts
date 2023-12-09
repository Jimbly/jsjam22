/* eslint-env browser */
declare module 'glov/client/global' {
  global {
    interface Window {
      // GLOV injected variables
      conf_platform?: string;
      conf_env?: string;

      // GLOV bootstrap
      debugmsg: (msg: string, clear: boolean) => void;
      Z: Record<string, number>;
    }

    const BUILD_TIMESTAMP: string;
    const __funcname: string; // eslint-disable-line no-underscore-dangle

    // GLOV ui.js
    const Z: Record<string, number>;
    // GL context
    let gl: WebGLRenderingContext | WebGL2RenderingContext;
    // GLOV profiler
    function profilerStart(name: string): void;
    function profilerStop(name?: string): void;
    function profilerStopStart(name: string): void;
    function profilerStartFunc(): void;
    function profilerStopFunc(): void;
  }
}
