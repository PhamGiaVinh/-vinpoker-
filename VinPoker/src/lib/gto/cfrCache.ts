import { PreflopSolver } from "./cfrSolver";
import { HandStrategy, ScenarioKey, scenarioKeyToString } from "./cfrTypes";

const cache = new Map<string, HandStrategy[]>();
const pending = new Map<string, Promise<HandStrategy[]>>();

let worker: Worker | null = null;
let nextId = 1;
const inflight = new Map<number, (r: HandStrategy[]) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./cfrSolver.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; result: HandStrategy[] }>) => {
      const cb = inflight.get(e.data.id);
      if (cb) {
        inflight.delete(e.data.id);
        cb(e.data.result);
      }
    };
    worker.onerror = (err) => {
      console.error("[cfr worker] error", err);
    };
  } catch (err) {
    console.warn("[cfr] worker unavailable, falling back to main thread", err);
    worker = null;
  }
  return worker;
}

// Main-thread fallback (also used in SSR / test).
let fallbackSolver: PreflopSolver | null = null;
function fallbackSolve(key: ScenarioKey): HandStrategy[] {
  if (!fallbackSolver) fallbackSolver = new PreflopSolver();
  return fallbackSolver.solve(key.pos, key.facing, key.betSize, key.raiserPos);
}

function solveCachedAsync(key: ScenarioKey): Promise<HandStrategy[]> {
  const k = scenarioKeyToString(key);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const p = pending.get(k);
  if (p) return p;

  const w = getWorker();
  const promise: Promise<HandStrategy[]> = w
    ? new Promise<HandStrategy[]>((resolve) => {
        const id = nextId++;
        inflight.set(id, resolve);
        w.postMessage({ id, key });
      })
    : Promise.resolve(fallbackSolve(key));

  const wrapped = promise.then((result) => {
    cache.set(k, result);
    pending.delete(k);
    return result;
  });
  pending.set(k, wrapped);
  return wrapped;
}

/** Sync wrapper kept for back-compat (uses cached value or falls back to main thread). */
function solveCached(key: ScenarioKey): HandStrategy[] {
  const k = scenarioKeyToString(key);
  const hit = cache.get(k);
  if (hit) return hit;
  const result = fallbackSolve(key);
  cache.set(k, result);
  return result;
}

function clearSolverCache() {
  cache.clear();
  pending.clear();
}
