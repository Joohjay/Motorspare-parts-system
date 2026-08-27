import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [
  spawn(command, ['--prefix', 'server', 'run', 'dev'], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  }),
  spawn(command, ['--prefix', 'client', 'run', 'dev'], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  }),
];

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[dev] ${signal} received, stopping both processes...`);
  for (const child of children) {
    child.kill(signal);
  }
  setTimeout(() => {
    for (const child of children) {
      child.kill('SIGKILL');
    }
    process.exit(0);
  }, 5000).unref();
}

for (const child of children) {
  child.on('error', (err) => {
    console.error('[dev] failed to start a child process:', err.message);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[dev] a child process exited (code: ${code ?? 'null'}, signal: ${signal ?? 'none'}); stopping the other...`,
    );
    shutdown('SIGTERM');
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));