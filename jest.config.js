module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Look for any test file in the tests folder
  roots: ['<rootDir>/tests'],
  // Load the setup file before running tests
  setupFiles: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};