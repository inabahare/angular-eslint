/**
 * Tests heavily adapted from:
 * https://github.com/nrwl/nx/blob/8a9565de01cdacdfab17553c7f5c31de988113e3/packages/linter/src/builders/lint/lint.impl.spec.ts
 *
 * Thanks, Nrwl folks!
 */
import { Architect } from '@angular-devkit/architect';
import { TestingArchitectHost } from '@angular-devkit/architect/testing';
import { logging, schema } from '@angular-devkit/core';
import { ESLint } from 'eslint';
import { Schema } from '../src/schema';

const mockFormatter = {
  format: jest
    .fn()
    .mockImplementation((results: ESLint.LintResult[]): string =>
      results
        .map(({ messages }) =>
          messages.map(({ message }) => message).join('\n'),
        )
        .join('\n'),
    ),
};
const mockLoadFormatter = jest.fn().mockReturnValue(mockFormatter);
const mockOutputFixes = jest.fn();
const loggerSpy = jest.fn();

const VALID_ESLINT_VERSION = '7.6';

class MockESLint {
  static version = VALID_ESLINT_VERSION;
  static outputFixes = mockOutputFixes;
  loadFormatter = mockLoadFormatter;
}

let mockReports: any[] = [
  { results: [], messages: [], usedDeprecatedRules: [] },
];
function mockEslint() {
  jest.doMock('../src/utils/eslint-utils', () => {
    return {
      lint: jest.fn().mockReturnValue(mockReports),
      loadESLint: jest.fn().mockReturnValue(
        Promise.resolve({
          ESLint: MockESLint,
        }),
      ),
    };
  });
}

function createValidRunBuilderOptions(
  additionalOptions: Partial<Schema> = {},
): Schema {
  return {
    lintFilePatterns: [],
    eslintConfig: './.eslintrc',
    exclude: ['excludedFile1'],
    fix: true,
    cache: true,
    cacheLocation: 'cacheLocation1',
    format: 'stylish',
    force: false,
    quiet: false,
    silent: false,
    ignorePath: null,
    ...additionalOptions,
  };
}

function setupMocks() {
  jest.resetModules();
  jest.clearAllMocks();
  jest.spyOn(process, 'chdir').mockImplementation(() => {});
  mockEslint();
}

async function runBuilder(options: Schema) {
  const registry = new schema.CoreSchemaRegistry();
  registry.addPostTransform(schema.transforms.addUndefinedDefaults);

  const testArchitectHost = new TestingArchitectHost('/root', '/root');
  const builderName = '@angular-eslint/builder:lint';

  /**
   * Require in the implementation from src so that we don't need
   * to run a build before tests run and it is dynamic enough
   * to come after jest does its mocking
   */
  const { default: builderImplementation } = require('../src/index');
  testArchitectHost.addBuilder(builderName, builderImplementation);

  const architect = new Architect(testArchitectHost, registry);
  const logger = new logging.Logger('');
  logger.subscribe(loggerSpy);

  const run = await architect.scheduleBuilder(builderName, options, {
    logger,
  });

  return run.result;
}

describe('Linter Builder', () => {
  beforeEach(() => {
    MockESLint.version = VALID_ESLINT_VERSION;
    mockReports = [{ results: [], messages: [], usedDeprecatedRules: [] }];
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('should throw if the eslint version is not supported', async () => {
    MockESLint.version = '1.6';
    setupMocks();
    const result = runBuilder(createValidRunBuilderOptions());
    await expect(result).rejects.toThrow(
      /ESLint must be version 7.6 or higher/,
    );
  });

  it('should not throw if the eslint version is supported', async () => {
    setupMocks();
    const result = runBuilder(createValidRunBuilderOptions());
    await expect(result).resolves.not.toThrow();
  });

  it('should invoke the linter with the options that were passed to the builder', async () => {
    setupMocks();
    const { lint } = require('../src/utils/eslint-utils');
    await runBuilder(
      createValidRunBuilderOptions({
        lintFilePatterns: [],
        eslintConfig: './.eslintrc',
        exclude: ['excludedFile1'],
        fix: true,
        quiet: false,
        cache: true,
        cacheLocation: 'cacheLocation1',
        format: 'stylish',
        force: false,
        silent: false,
        ignorePath: null,
      }),
    );
    expect(lint).toHaveBeenCalledWith('/root/.eslintrc', {
      lintFilePatterns: [],
      eslintConfig: './.eslintrc',
      exclude: ['excludedFile1'],
      fix: true,
      quiet: false,
      cache: true,
      cacheLocation: 'cacheLocation1',
      format: 'stylish',
      force: false,
      silent: false,
      ignorePath: null,
    });
  });

  it('should throw if no reports generated', async () => {
    mockReports = [];
    setupMocks();
    const result = runBuilder(
      createValidRunBuilderOptions({
        lintFilePatterns: ['includedFile1'],
      }),
    );
    await expect(result).rejects.toThrow(
      /Invalid lint configuration. Nothing to lint./,
    );
  });

  it('should create a new instance of the formatter with the selected user option', async () => {
    setupMocks();
    await runBuilder(
      createValidRunBuilderOptions({
        eslintConfig: './.eslintrc',
        lintFilePatterns: ['includedFile1'],
        format: 'json',
      }),
    );
    expect(mockLoadFormatter).toHaveBeenCalledWith('json');
    await runBuilder(
      createValidRunBuilderOptions({
        eslintConfig: './.eslintrc',
        lintFilePatterns: ['includedFile1'],
        format: 'html',
      }),
    );
    expect(mockLoadFormatter).toHaveBeenCalledWith('html');
  });

  it('should pass all the reports to the fix engine, even if --fix is false', async () => {
    setupMocks();
    await runBuilder(
      createValidRunBuilderOptions({
        eslintConfig: './.eslintrc',
        lintFilePatterns: ['includedFile1'],
        format: 'json',
        fix: false,
      }),
    );
    expect(mockOutputFixes).toHaveBeenCalled();
  });

  describe('bundled results', () => {
    it('should log if there are errors or warnings', async () => {
      mockReports = [
        {
          errorCount: 1,
          warningCount: 4,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
        {
          errorCount: 3,
          warningCount: 6,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
      ];
      setupMocks();
      await runBuilder(
        createValidRunBuilderOptions({
          eslintConfig: './.eslintrc',
          lintFilePatterns: ['includedFile1'],
          format: 'json',
          silent: false,
        }),
      );
      const flattenedCalls = loggerSpy.mock.calls.reduce((logs, call) => {
        return [...logs, call[0]];
      }, []);
      expect(flattenedCalls).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint errors found in the listed files.',
          ),
        }),
      );
      expect(flattenedCalls).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint warnings found in the listed files.',
          ),
        }),
      );
    });

    it('should log if there are no warnings or errors', async () => {
      mockReports = [
        {
          errorCount: 0,
          warningCount: 0,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
        {
          errorCount: 0,
          warningCount: 0,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
      ];
      setupMocks();
      await runBuilder(
        createValidRunBuilderOptions({
          eslintConfig: './.eslintrc',
          lintFilePatterns: ['includedFile1'],
          format: 'json',
          silent: false,
        }),
      );
      const flattenedCalls = loggerSpy.mock.calls.reduce((logs, call) => {
        return [...logs, call[0]];
      }, []);
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint errors found in the listed files.',
          ),
        }),
      );
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint warnings found in the listed files.',
          ),
        }),
      );
      expect(flattenedCalls).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('All files pass linting.'),
        }),
      );
    });

    it('should not log if the silent flag was passed', async () => {
      mockReports = [
        {
          errorCount: 1,
          warningCount: 4,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
        {
          errorCount: 3,
          warningCount: 6,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
      ];
      setupMocks();
      await runBuilder(
        createValidRunBuilderOptions({
          eslintConfig: './.eslintrc',
          lintFilePatterns: ['includedFile1'],
          format: 'json',
          silent: true,
        }),
      );
      const flattenedCalls = loggerSpy.mock.calls.reduce((logs, call) => {
        return [...logs, call[0]];
      }, []);
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint errors found in the listed files.',
          ),
        }),
      );
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint warnings found in the listed files.',
          ),
        }),
      );
    });

    it('should not log warnings if the quiet flag was passed', async () => {
      mockReports = [
        {
          errorCount: 0,
          warningCount: 4,
          results: [],
          messages: [
            {
              line: 0,
              column: 0,
              message: 'Mock warning message',
              severity: 1,
              ruleId: null,
            },
          ],
          usedDeprecatedRules: [],
        },
        {
          errorCount: 0,
          warningCount: 6,
          results: [],
          messages: [],
          usedDeprecatedRules: [],
        },
      ];
      setupMocks();
      await runBuilder(
        createValidRunBuilderOptions({
          eslintConfig: './.eslintrc',
          lintFilePatterns: ['includedFile1'],
          format: 'json',
          quiet: true,
          silent: false,
        }),
      );
      const flattenedCalls = loggerSpy.mock.calls.reduce((logs, call) => {
        return [...logs, call[0]];
      }, []);
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('Mock warning message'),
        }),
      );
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint errors found in the listed files.',
          ),
        }),
      );
      expect(flattenedCalls).not.toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining(
            'Lint warnings found in the listed files.',
          ),
        }),
      );
      expect(flattenedCalls).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('All files pass linting.'),
        }),
      );
    });
  });

  it('should be a success if there are no errors', async () => {
    mockReports = [
      {
        errorCount: 0,
        warningCount: 4,
        results: [],
        messages: [],
        usedDeprecatedRules: [],
      },
      {
        errorCount: 0,
        warningCount: 6,
        results: [],
        messages: [],
        usedDeprecatedRules: [],
      },
    ];
    setupMocks();
    const output = await runBuilder(
      createValidRunBuilderOptions({
        eslintConfig: './.eslintrc',
        lintFilePatterns: ['includedFile1'],
        format: 'json',
        silent: true,
      }),
    );
    expect(output.success).toBeTruthy();
  });

  it('should be a success if there are errors but the force flag is true', async () => {
    mockReports = [
      {
        errorCount: 2,
        warningCount: 4,
        results: [],
        messages: [],
        usedDeprecatedRules: [],
      },
      {
        errorCount: 3,
        warningCount: 6,
        results: [],
        messages: [],
        usedDeprecatedRules: [],
      },
    ];
    setupMocks();
    const output = await runBuilder(
      createValidRunBuilderOptions({
        eslintConfig: './.eslintrc',
        lintFilePatterns: ['includedFile1'],
        format: 'json',
        silent: true,
        force: true,
      }),
    );
    expect(output.success).toBeTruthy();
  });

  it('should be a failure if there are errors and the force flag is false', async () => {
    mockReports = [
      {
        errorCount: 2,
        warningCount: 4,
        results: [],
        messages: [],
        usedDeprecatedRules: [],
      },
      {
        errorCount: 3,
        warningCount: 6,
        results: [],
        messages: [],
        usedDeprecatedRules: [],
      },
    ];
    setupMocks();
    const output = await runBuilder(
      createValidRunBuilderOptions({
        eslintConfig: './.eslintrc',
        lintFilePatterns: ['includedFile1'],
        format: 'json',
        silent: true,
        force: false,
      }),
    );
    expect(output.success).toBeFalsy();
  });
});
