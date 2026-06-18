// Canonical synthetic fixture — NOT production data. Used for the result-card
// preview/snapshot tests and to demo the "B+ · Tight Solid" story.
import { DrillAnswer } from "./types";

export const DEMO_ANSWERS: DrillAnswer[] = [
  // preflop_discipline → ~82
  { handId: "pfd_1", optionId: "a", selfConfidence: "high" },
  { handId: "pfd_2", optionId: "b", selfConfidence: "medium" },
  { handId: "pfd_3", optionId: "a", selfConfidence: "high" },
  { handId: "pfd_4", optionId: "b", selfConfidence: "low" },
  // position_steal → ~68
  { handId: "ps_1", optionId: "b", selfConfidence: "medium" },
  { handId: "ps_2", optionId: "b", selfConfidence: "low" },
  { handId: "ps_3", optionId: "b", selfConfidence: "medium" },
  { handId: "ps_4", optionId: "c", selfConfidence: "low" },
  // vs_aggro → ~60 (weakest)
  { handId: "va_1", optionId: "b", selfConfidence: "medium" },
  { handId: "va_2", optionId: "c", selfConfidence: "low" },
  { handId: "va_3", optionId: "c", selfConfidence: "low" },
  { handId: "va_4", optionId: "b", selfConfidence: "medium" },
  // vs_nit_passive → ~85
  { handId: "vnp_1", optionId: "a", selfConfidence: "high" },
  { handId: "vnp_2", optionId: "a", selfConfidence: "high" },
  { handId: "vnp_3", optionId: "b", selfConfidence: "medium" },
  { handId: "vnp_4", optionId: "b", selfConfidence: "medium" },
  // tournament_pressure → ~74
  { handId: "tp_1", optionId: "b", selfConfidence: "medium" },
  { handId: "tp_2", optionId: "b", selfConfidence: "medium" },
  { handId: "tp_3", optionId: "b", selfConfidence: "low" },
  { handId: "tp_4", optionId: "b", selfConfidence: "medium" },
];
