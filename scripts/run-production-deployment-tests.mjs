import { spawn } from 'node:child_process';
import process from 'node:process';

const executable = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const child = spawn(
  executable,
  [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'scripts/deployment/test-production-deployment.ps1',
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  },
);

child.once('error', (error) => {
  process.stderr.write(`Unable to start ${executable}: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.stderr.write(`Deployment tests stopped by ${signal}.\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
