import 'dotenv/config';
import { spawn } from 'node:child_process';

const isProduction = process.env.NODE_ENV === 'production';
const required = ['DATABASE_URL'];
if (isProduction) {
  for (const name of required) {
    if (!process.env[name]) throw new Error(`${name} is required in production`);
  }
}

const run = (script) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [script], {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('error', reject);
  child.on('exit', (code, signal) => {
    if (signal) return reject(new Error(`${script} exited on ${signal}`));
    if (code !== 0) return reject(new Error(`${script} exited with code ${code}`));
    resolve();
  });
});

await run('scripts/migrate.js');

const child = spawn(process.execPath, ['src/server.js'], {
  stdio: 'inherit',
  env: process.env,
});

const shutdown = (signal) => {
  child.kill(signal);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
