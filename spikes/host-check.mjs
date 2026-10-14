import { captureHostSnapshot } from '../packages/host-info/dist/index.js';
const start = performance.now();
const snapshot = await captureHostSnapshot();
console.log(JSON.stringify({ durationMs: Math.round(performance.now() - start), os: snapshot.os, osVersion: snapshot.osVersion, ramMb: snapshot.ramMb, gpus: snapshot.gpus, displays: snapshot.displays }, null, 2));
