import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const files = readdirSync(resolve('tests')).filter(name => name.endsWith('.mjs')).sort();
if (!files.length) throw new Error('No test files found');
for (const file of files) {
  const result = spawnSync(process.execPath, [resolve('tests', file)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Passed ${files.length} test suites.`);
