export function createSingleFlightGuard() {
  let inFlight = false;
  return {
    begin(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish(): void {
      inFlight = false;
    },
    isBusy(): boolean {
      return inFlight;
    },
  };
}
