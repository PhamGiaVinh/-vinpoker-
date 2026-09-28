export default {
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    include: ["tests/dealerSwingAuthorization/**/*.test.ts"],
  },
};
