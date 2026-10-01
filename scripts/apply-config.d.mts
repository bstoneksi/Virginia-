/**
 * Type surface of scripts/apply-config.mjs (plain Node ESM) for TypeScript callers — the test in
 * server/applyConfig.test.ts. Keep in step with the exports of apply-config.mjs.
 */

/** The part of assistant.config.json the static files need; the server validates the full shape. */
export interface StaticConfig {
  assistant: { name: string; tagline: string };
  owner: { fullName: string };
  branding: { themeColor: string };
  [key: string]: unknown;
}

export interface StaticValues {
  name: string;
  description: string;
  themeColor: string;
}

export interface ApplyResult {
  configPath: string;
  config: StaticConfig;
  /** Repo-relative paths (forward slashes) that were, or with `check` would be, rewritten. */
  changed: string[];
}

export declare const CONFIG_FILE: string;
export declare const LOCAL_CONFIG_FILE: string;
export declare const CONFIG_ENV: string;
export declare const MANIFEST_FILE: string;
export declare const INDEX_HTML_FILE: string;

export declare function resolveConfigPath(rootDir: string, env?: NodeJS.ProcessEnv): string;
export declare function readConfig(file: string): StaticConfig;
export declare function staticValues(config: StaticConfig): StaticValues;
export declare function applyManifest(text: string, config: StaticConfig): string;
export declare function applyIndexHtml(html: string, config: StaticConfig): string;
export declare function applyConfig(rootDir: string, env?: NodeJS.ProcessEnv, options?: { check?: boolean }): ApplyResult;
