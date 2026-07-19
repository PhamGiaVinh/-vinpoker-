import assert from "node:assert/strict";
import test from "node:test";
import { findMissingContracts, schemaInventory } from "./probe-live-schema-contracts.mjs";

const schema = `
CREATE TABLE public.game_tables (
    id uuid NOT NULL,
    opened_at timestamp with time zone,
    dealer_open_operation_id uuid
);

CREATE TABLE public.dealer_open_operations (
    id uuid NOT NULL
);

CREATE FUNCTION public.is_club_dealer_control(_user_id uuid, _club_id uuid) RETURNS boolean
    LANGUAGE sql
    AS $$ SELECT true $$;

CREATE FUNCTION public.assign_dealer_to_table(
    p_attendance_id uuid,
    p_table_id uuid,
    p_assigned_at timestamp with time zone DEFAULT now(),
    p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS jsonb
    LANGUAGE sql
    AS $$ SELECT '{}'::jsonb $$;
`;

test("schema inventory extracts relations, columns and function argument names", () => {
  const inventory = schemaInventory(schema);
  assert.equal(inventory.relations.has("public.game_tables"), true);
  assert.equal(inventory.relationBodies.get("public.game_tables").includes("opened_at"), true);
  assert.deepEqual(inventory.functions.get("public.is_club_dealer_control"), [["_user_id", "_club_id"]]);
});
test("probe accepts matching typed contracts", () => {
  const missing = findMissingContracts(schema, [
    { type: "relation", name: "public.game_tables" },
    { type: "column", relation: "public.game_tables", name: "opened_at" },
    {
      type: "function",
      name: "public.assign_dealer_to_table",
      arguments: ["p_attendance_id", "p_table_id", "p_assigned_at", "p_swing_due_at"],
    },
  ]);
  assert.deepEqual(missing, []);
});

test("probe reports a missing column and signature without converting them to success", () => {
  const missing = findMissingContracts(schema, [
    { type: "column", relation: "public.game_tables", name: "missing_column" },
    { type: "function", name: "public.is_club_dealer_control", arguments: ["_club_id"] },
  ]);
  assert.deepEqual(missing, [
    "column:public.game_tables.missing_column",
    "function:public.is_club_dealer_control(_club_id)",
  ]);
});
