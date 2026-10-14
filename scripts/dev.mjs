// Runs the API server (tsx watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const env = process.env;

const procs = [
  spawn(npx, ['tsx', 'watch', '--clear-screen=false', 'src/server/index.ts'], { stdio: 'inherit', env, shell: isWin }),
  spawn(npx, ['vite'], { stdio: 'inherit', env, shell: isWin }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && code !== 0 && stop());
