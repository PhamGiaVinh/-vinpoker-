import { loadConfig } from "./config.js";
import { AutomationGateway } from "./gateway.js";
import { SqliteAutomationStore } from "./store/sqlite-store.js";

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();
const store = new SqliteAutomationStore({ dbPath: config.dbPath });
const gateway = new AutomationGateway({ store, config });

try {
  if (command === "seed") {
    print(gateway.seedFixtures({ reset: !args.includes("--no-reset") }));
  } else if (command === "status") {
    print(gateway.status());
  } else if (command === "kill-switch") {
    const [scope = "GLOBAL", scopeKey = "*", state = "on"] = args;
    if (!["on", "off"].includes(state)) {
      throw new Error("Usage: npm run kill-switch -- GLOBAL '*' on|off");
    }
    print(gateway.setKillSwitch({
      scope: scope.toUpperCase(),
      scope_key: scopeKey,
      enabled: state === "on",
      reason_code: "DEV_CLI",
    }));
  } else {
    throw new Error("Usage: node src/cli.js seed|status|kill-switch");
  }
} finally {
  store.close();
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
