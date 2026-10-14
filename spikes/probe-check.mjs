import { readFileSync } from 'node:fs';
import { parseFuryCapture, probeDiff } from '../packages/health/dist/index.js';
const paths = process.argv.slice(2);
if (paths.length !== 2) throw new Error('Cần hai đường dẫn capture JSON');
const probes = paths.map((file) => parseFuryCapture(JSON.parse(readFileSync(file, 'utf8'))).probe);
const changes = probeDiff(probes[0], probes[1]);
console.log(JSON.stringify({ changedFields: changes.map((change) => change.path), total: changes.length }, null, 2));
