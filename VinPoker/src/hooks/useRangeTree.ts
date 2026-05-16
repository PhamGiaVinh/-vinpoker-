import {
  createContext, createElement, useCallback, useContext, useEffect,
  useMemo, useReducer, useRef, useState, type ReactNode,
} from "react";
import {
  ActionStep, HandAction, Position, Range, StackDepth,
  defaultRange, getLastRaiser, nodeKey, updateHandAction,
} from "@/lib/gto/rangeTree";
import { getPrecomputedRange, getEffectiveRange, makeSpotKey, subscribeRangeUpdates, subscribeUserRangeUpdates } from "@/lib/gto/precomputed";

const STORAGE_KEY = "gto_ranges_v5";
const SCHEMA_VERSION = 5;

interface State {
  stackDepth: StackDepth;
  actionPath: ActionStep[];
  viewingPosition: Position;
  selectedHand: string | null;
  ranges: Record<string, Range>;
}

type Action =
  | { type: "PUSH_STEP"; step: ActionStep }
  | { type: "POP_TO"; idx: number }
  | { type: "SET_VIEWING"; position: Position }
  | { type: "SET_STACK_DEPTH"; depth: StackDepth }
  | { type: "SET_SELECTED_HAND"; hand: string | null }
  | {
      type: "UPDATE_HAND";
      nk: string;
      hand: string;
      actionKey: keyof HandAction;
      freq: number;
      viewing: Position;
      facing: boolean;
    }
  | { type: "RESET_NODE"; nk: string }
  | { type: "SET_NODE_RANGE"; nk: string; range: Range }
  | { type: "RESET_ALL" }
  | { type: "HYDRATE"; state: Partial<State> };

const initial: State = {
  stackDepth: 50,
  actionPath: [],
  viewingPosition: "UTG",
  selectedHand: null,
  ranges: {},
};

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "PUSH_STEP": {
      const newPath = [...state.actionPath, action.step];
      const isAggressive =
        action.step.action === "raise" || action.step.action === "allin";
      return {
        ...state,
        actionPath: newPath,
        viewingPosition: isAggressive ? action.step.position : state.viewingPosition,
        selectedHand: null,
      };
    }
    case "POP_TO":
      return {
        ...state,
        actionPath: state.actionPath.slice(0, action.idx),
        selectedHand: null,
      };
    case "SET_VIEWING":
      return { ...state, viewingPosition: action.position, selectedHand: null };
    case "SET_STACK_DEPTH":
      return {
        ...initial,
        stackDepth: action.depth,
        viewingPosition: state.viewingPosition,
      };
    case "SET_SELECTED_HAND":
      return { ...state, selectedHand: action.hand };
    case "UPDATE_HAND": {
      const base =
        state.ranges[action.nk] ?? defaultRange(action.viewing, action.facing);
      const updated = updateHandAction(base, action.hand, action.actionKey, action.freq);
      return { ...state, ranges: { ...state.ranges, [action.nk]: updated } };
    }
    case "RESET_NODE": {
      const { [action.nk]: _omit, ...rest } = state.ranges;
      return { ...state, ranges: rest };
    }
    case "SET_NODE_RANGE":
      return { ...state, ranges: { ...state.ranges, [action.nk]: action.range } };
    case "RESET_ALL":
      return { ...initial, stackDepth: state.stackDepth };
    case "HYDRATE":
      return { ...state, ...action.state };
    default:
      return state;
  }
}

interface Ctx {
  state: State;
  pushStep: (step: ActionStep) => void;
  popTo: (idx: number) => void;
  setViewing: (p: Position) => void;
  setStackDepth: (d: StackDepth) => void;
  setSelectedHand: (h: string | null) => void;
  updateHand: (hand: string, actionKey: keyof HandAction, freq: number) => void;
  resetNode: () => void;
  setCurrentRange: (range: Range) => void;
  resetAll: () => void;
  currentRange: Range;
  currentNodeKey: string;
  isFacingRaise: boolean;
  isGtoMode: boolean;
}

const RangeCtx = createContext<Ctx | null>(null);

export function RangeTreeProvider({ children, personalMode = false }: { children: ReactNode; personalMode?: boolean }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const isHydrating = useRef(true);

  useEffect(() => {
    if (!isHydrating.current) return;
    isHydrating.current = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed.version !== SCHEMA_VERSION) {
        console.warn("[GTO] Schema version mismatch");
        return;
      }
      dispatch({
        type: "HYDRATE",
        state: {
          ranges: parsed.ranges ?? {},
          actionPath: parsed.actionPath ?? [],
          stackDepth: parsed.stackDepth ?? 50,
          viewingPosition: parsed.viewingPosition ?? "UTG",
        },
      });
    } catch (err) {
      console.warn("[GTO] Failed to hydrate:", err);
    }
  }, []);

  useEffect(() => {
    if (isHydrating.current) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: SCHEMA_VERSION,
          ranges: state.ranges,
          actionPath: state.actionPath,
          stackDepth: state.stackDepth,
          viewingPosition: state.viewingPosition,
        }),
      );
    } catch (err) {
      console.warn("[GTO] Failed to persist:", err);
    }
  }, [state.ranges, state.actionPath, state.stackDepth, state.viewingPosition]);

  const pushStep = useCallback((step: ActionStep) => dispatch({ type: "PUSH_STEP", step }), []);
  const popTo = useCallback((idx: number) => dispatch({ type: "POP_TO", idx }), []);
  const setViewing = useCallback((p: Position) => dispatch({ type: "SET_VIEWING", position: p }), []);
  const setStackDepth = useCallback((d: StackDepth) => dispatch({ type: "SET_STACK_DEPTH", depth: d }), []);
  const setSelectedHand = useCallback((h: string | null) => dispatch({ type: "SET_SELECTED_HAND", hand: h }), []);
  const resetAll = useCallback(() => dispatch({ type: "RESET_ALL" }), []);

  const currentNodeKey = useMemo(
    () => nodeKey(state.actionPath, state.viewingPosition, state.stackDepth),
    [state.actionPath, state.viewingPosition, state.stackDepth],
  );

  const isFacingRaise = useMemo(
    () => !!getLastRaiser(state.actionPath),
    [state.actionPath],
  );

  const spotType = useMemo<"OPEN" | "VS_3B" | "VS_4B" | "VS_ALLIN">(() => {
    if (state.actionPath.length === 0) return "OPEN";
    const raiseCount = state.actionPath.filter(
      (s) => s.action === "raise" || s.action === "allin"
    ).length;
    if (raiseCount === 1) return "VS_3B";
    if (raiseCount === 2) return "VS_4B";
    return "VS_ALLIN";
  }, [state.actionPath]);

  // Tick để re-resolve range khi remote cache update qua realtime
  const [remoteTick, setRemoteTick] = useState(0);
  useEffect(() => subscribeRangeUpdates(() => setRemoteTick((t) => t + 1)), []);
  useEffect(() => subscribeUserRangeUpdates(() => setRemoteTick((t) => t + 1)), []);

  const { currentRange, isGtoMode } = useMemo(() => {
    if (state.ranges[currentNodeKey]) {
      return { currentRange: state.ranges[currentNodeKey], isGtoMode: false };
    }
    const spotKey = makeSpotKey(state.viewingPosition, spotType, state.stackDepth);
    const gto = personalMode ? getEffectiveRange(spotKey) : getPrecomputedRange(spotKey);
    if (gto) {
      return { currentRange: gto, isGtoMode: !personalMode };
    }
    return {
      currentRange: defaultRange(state.viewingPosition, isFacingRaise),
      isGtoMode: false,
    };
  }, [state.ranges, currentNodeKey, state.viewingPosition, spotType, state.stackDepth, isFacingRaise, remoteTick, personalMode]);

  const updateHand = useCallback(
    (hand: string, actionKey: keyof HandAction, freq: number) => {
      dispatch({
        type: "UPDATE_HAND",
        nk: currentNodeKey,
        hand,
        actionKey,
        freq,
        viewing: state.viewingPosition,
        facing: isFacingRaise,
      });
    },
    [currentNodeKey, state.viewingPosition, isFacingRaise],
  );

  const resetNode = useCallback(() => {
    dispatch({ type: "RESET_NODE", nk: currentNodeKey });
  }, [currentNodeKey]);

  const setCurrentRange = useCallback((range: Range) => {
    dispatch({ type: "SET_NODE_RANGE", nk: currentNodeKey, range });
  }, [currentNodeKey]);

  const value = useMemo<Ctx>(
    () => ({
      state, pushStep, popTo, setViewing, setStackDepth, setSelectedHand,
      updateHand, resetNode, setCurrentRange, resetAll, currentRange, currentNodeKey, isFacingRaise, isGtoMode,
    }),
    [state, pushStep, popTo, setViewing, setStackDepth, setSelectedHand,
      updateHand, resetNode, setCurrentRange, resetAll, currentRange, currentNodeKey, isFacingRaise, isGtoMode],
  );

  return createElement(RangeCtx.Provider, { value }, children);
}

export function useRangeTree(): Ctx {
  const ctx = useContext(RangeCtx);
  if (!ctx) throw new Error("useRangeTree must be used inside RangeTreeProvider");
  return ctx;
}
