import { readFile } from "node:fs/promises";
import { resultsChecksum, validateResultsExport } from "../server/modules/results.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run results:validate -- export.json [--sample]");
const input = JSON.parse(await readFile(file,"utf8"));
if (process.argv.includes("--sample")) {
  if (!Array.isArray(input.rows)) throw new Error("A downloaded roster with rows is required.");
  const rows = input.rows.map(({registrationId,courseId},index) => ({registrationId,courseId,mark:index % 2 ? 50 : 75}));
  const sample = {sourceRef:`SAMPLE-${Date.now()}`,rows,expectedRowCount:rows.length,expectedMarkTotal:rows.reduce((sum,row) => sum + row.mark,0),checksum:resultsChecksum(rows)};
  validateResultsExport(sample);
  console.log(JSON.stringify(sample,null,2));
} else console.log(JSON.stringify({validated:true,sourceRef:input.sourceRef,...validateResultsExport(input)},null,2));
