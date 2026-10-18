// Types for scripts/vercel-config.mjs (plain JavaScript so the build script runs on Node directly).
export type VercelRoute =
  | { src: string; dest?: string; headers?: Record<string, string>; continue?: boolean }
  | { handle: 'filesystem' | 'rewrite' | 'resource' | 'miss' | 'hit' | 'error' };

export declare const SECURITY_HEADERS: Record<string, string>;
export declare const ROUTES: VercelRoute[];
export declare const CRONS: { path: string; schedule: string }[];
export declare const FUNCTION_CONFIG: {
  runtime: string;
  handler: string;
  launcherType: 'Nodejs';
  shouldAddHelpers: boolean;
  maxDuration: number;
  regions: string[];
};
