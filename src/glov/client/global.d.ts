declare module 'glov-global' {
  global {
    interface Window {
      // GLOV injected variables
      conf_platform?: string;
      conf_env?: string;

      // External injected variables
      FB?: unknown;
      FBInstant?: unknown;
      androidwrapper?: unknown;
      webkit?: { messageHandlers?: { iosWrapper?: unknown } };

      // GLOV ui.js
      Z: Record<string, number>;
    }
  }
}
