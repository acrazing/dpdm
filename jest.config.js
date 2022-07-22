/*
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

module.exports = {
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  cacheDirectory: '.cache/jest',
  collectCoverageFrom: ['<rootDir>/src/**/*.{ts,tsx}', '!**/*.d.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.{ts,tsx}'],
};
