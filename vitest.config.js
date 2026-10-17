// @ts-check
import { defineConfig } from 'vitest/config';

const COVERAGE_THRESHOLD = 90;

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Live tests hit real services; `npm run test:live` selects them, every other script excludes them.
    tags: [
      { name: 'live', description: 'Calls real external services; run with npm run test:live.' },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'infra/lib/**/*.js'],
      exclude: [
        // Entry point: wires real environment, logger and a network listener; smoke-tested in the container.
        'src/server/main.js',
        // Entry point: reads CDK context and instantiates the stacks; exercised by `cdk synth` in CI.
        'infra/bin/platform.js',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
  },
});
