import { loadConfig } from "./config.js";
import { AutomationGateway } from "./gateway.js";
import { SqliteAutomationStore } from "./store/sqlite-store.js";
import {
  readCanonicalDigestClubs,
  seedCanonicalTestShadow,
} from "./canonical/test-shadow-source.js";
import { verifyShadowEvidence } from "./canonical/verify-test-shadow.js";

const [command, ...args] = process.argv.slice(2);
const config = loadConfig();
const store = new SqliteAutomationStore({ dbPath: config.dbPath });
const gateway = new AutomationGateway({ store, config });

try {
  if (command === "seed") {
    print(gateway.seedFixtures({ reset: !args.includes("--no-reset") }));
  } else if (command === "seed-test-shadow") {
    const clubs = await readCanonicalDigestClubs();
    print(seedCanonicalTestShadow({
      store,
      validator: gateway.contractApi(),
      clubs,
    }));
  } else if (command === "dispatch-test-shadow") {
    const deliveries = [];
    while (true) {
      const claimed = gateway.claimMockDelivery();
      if (!claimed) break;
      deliveries.push(gateway.dispatchMockDelivery({
        delivery_id: claimed.delivery_id,
        provider_lease_token: claimed.provider_lease_token,
        outcome: "SENT",
      }));
    }
    print({ dispatched: deliveries.length, deliveries });
  } else if (command === "report-test-shadow") {
    print(store.shadowEvidence());
  } else if (command === "verify-test-shadow") {
    const clubs = await readCanonicalDigestClubs();
    print(verifyShadowEvidence({
      clubs,
      evidence: store.shadowEvidence(),
      status: gateway.status(),
    }));
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
    throw new Error("Usage: node src/cli.js seed|seed-test-shadow|dispatch-test-shadow|report-test-shadow|verify-test-shadow|status|kill-switch");
  }
} finally {
  store.close();
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
