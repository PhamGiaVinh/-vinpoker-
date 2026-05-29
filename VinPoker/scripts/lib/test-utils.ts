export function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`❌ ${msg}: expected "${expected}", got "${actual}"`);
  }
}

export function assertNotNull<T>(value: T | null | undefined, msg: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(`❌ ${msg}: expected non-null, got ${value}`);
  }
}

export function assertErrorCode(
  error: { code?: string } | null,
  expectedCode: string,
  msg: string,
) {
  if (!error) {
    throw new Error(`❌ ${msg}: expected error with code "${expectedCode}", got no error`);
  }
  if (error.code !== expectedCode) {
    throw new Error(`❌ ${msg}: expected error code "${expectedCode}", got "${error.code}"`);
  }
}

export function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`❌ ${msg}: assertion failed`);
  }
}

export function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}
