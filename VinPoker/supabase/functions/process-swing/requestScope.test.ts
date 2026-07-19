import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseRequestedClubIds } from "./requestScope.ts";

const CLUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CLUB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const SEEDED_CLUB = "22222222-2222-2222-2222-222222222222";

Deno.test("club_ids omitted preserves the legacy fallback", () => {
  assertEquals(parseRequestedClubIds(undefined), undefined);
});

Deno.test("an explicit empty club_ids array remains an empty scope", () => {
  assertEquals(parseRequestedClubIds([]), []);
});

Deno.test("club_ids are validated and de-duplicated in caller order", () => {
  assertEquals(
    parseRequestedClubIds([
      CLUB_A,
      CLUB_B,
      SEEDED_CLUB,
      CLUB_A.toUpperCase(),
    ]),
    [CLUB_A, CLUB_B, SEEDED_CLUB],
  );
});

Deno.test("invalid multi-club scopes fail closed", () => {
  assertThrows(() => parseRequestedClubIds(CLUB_A), TypeError);
  assertThrows(() => parseRequestedClubIds(["not-a-uuid"]), TypeError);
  assertThrows(() => parseRequestedClubIds([CLUB_A, null]), TypeError);
});
