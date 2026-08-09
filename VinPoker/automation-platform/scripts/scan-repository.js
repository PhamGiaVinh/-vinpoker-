import { projectRoot } from "../src/config.js";
import {
  formatRepositorySecretScan,
  scanRepositorySecretLeaks,
} from "./lib/repository-secret-scanner.js";

const result = scanRepositorySecretLeaks({ projectRoot });
const output = formatRepositorySecretScan(result);
if (!result.findings.length) {
  process.stdout.write(`${output}\n`);
} else {
  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
}
