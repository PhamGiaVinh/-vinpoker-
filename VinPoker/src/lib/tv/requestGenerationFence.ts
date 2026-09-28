export function createRequestGenerationFence() {
  let generation = 0;
  return {
    begin: () => ++generation,
    isCurrent: (requestGeneration: number) => requestGeneration === generation,
    invalidate: () => { generation += 1; },
  };
}
