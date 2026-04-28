export interface PreloadConfig {
  modulesDir: string;
  aliases: Record<string, string>;
  preloaded: boolean;
  _version: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __NODULUS_PRELOAD_CONFIG__: PreloadConfig | undefined;
}

export function isPreloaderActive(): boolean {
  return globalThis.__NODULUS_PRELOAD_CONFIG__?.preloaded === true;
}

export function getPreloadConfig(): PreloadConfig | undefined {
  return globalThis.__NODULUS_PRELOAD_CONFIG__;
}
