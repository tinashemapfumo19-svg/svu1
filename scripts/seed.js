import { open, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from 'node:crypto';
import { dirname } from "node:path";
import { createSeedData } from "./seed-data.js";
import { assertDevelopmentSeed,jsonSeedTarget,assertRegularSeedPath } from './development-seed-safety.js';

assertDevelopmentSeed();
const dataFile = jsonSeedTarget(process.env.SVU_DATA_FILE || 'data/dev-store.json',process.argv.slice(2));
await assertRegularSeedPath(dataFile);
const seed = createSeedData();

await mkdir(dirname(dataFile), { recursive: true });
const temporary = `${dataFile}.${randomUUID()}.seed.tmp`;
let owned = false;
try {
  const file = await open(temporary,'wx',0o600);owned = true;
  try {await file.writeFile(`${JSON.stringify(seed,null,2)}\n`,'utf8');}finally {await file.close();}
  await assertRegularSeedPath(dataFile);
  await rename(temporary,dataFile);
} finally {if(owned)await rm(temporary,{force:true});}

console.log(`Seeded ${dataFile}`);
