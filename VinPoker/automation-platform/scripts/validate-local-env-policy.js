import { projectRoot } from "../src/config.js";
import {
  formatLocalEnvPolicy,
  validateLocalEnvPolicy,
} from "./lib/local-env-policy.js";

const result = validateLocalEnvPolicy({ projectRoot });
const output = formatLocalEnvPolicy(result);
if (result.valid) {
  process.stdout.write(`${output}\n`);
} else {
  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
}
