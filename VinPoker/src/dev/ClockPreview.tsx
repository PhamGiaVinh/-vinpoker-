// DEV-only entry for the tournament-clock visual harness (reached at /__dev/clock,
// gated by import.meta.env.DEV in App.tsx so it is tree-shaken from production).
// Mirrors src/dev/TablePreview.tsx.
export { default } from "@/components/tournament-clock/TournamentClockPreview";
