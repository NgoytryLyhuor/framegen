import { cpSync } from 'node:fs';

const src = 'node_modules/framegen/weights';
const dest = 'public/weights';

cpSync(src, dest, { recursive: true });
console.log('copied framegen weights -> public/weights');