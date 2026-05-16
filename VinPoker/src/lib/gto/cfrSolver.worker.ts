/// <reference lib="webworker" />
import { PreflopSolver } from "./cfrSolver";
import { ScenarioKey, HandStrategy, scenarioKeyToString } from "./cfrTypes";

const solver = new PreflopSolver();
const cache = new Map<string, HandStrategy[]>();

interface Req {
  id: number;
  key: ScenarioKey;
}
interface Res {
  id: number;
  result: HandStrategy[];
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, key } = e.data;
  const ks = scenarioKeyToString(key);
  let result = cache.get(ks);
  if (!result) {
    result = solver.solve(key.pos, key.facing, key.betSize, key.raiserPos);
    cache.set(ks, result);
  }
  const res: Res = { id, result };
  (self as unknown as Worker).postMessage(res);
};

export {};
