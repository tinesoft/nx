import { detectPlugins } from './init-v2';

// Mock dependencies
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn((path: string) => {
    if (path === 'package.json') return true;
    return false;
  }),
}));

jest.mock('../../utils/fileutils', () => ({
  readJsonFile: jest.fn(),
  fileExists: jest.fn(() => false),
}));

jest.mock('../../utils/workspace-context', () => ({
  globWithWorkspaceContextSync: jest.fn(() => []),
}));

jest.mock('../../utils/output', () => ({
  output: { log: jest.fn() },
}));

import { existsSync } from 'fs';
import { readJsonFile } from '../../utils/fileutils';
import { globWithWorkspaceContextSync } from '../../utils/workspace-context';
const mockReadJsonFile = readJsonFile as jest.Mock;
const mockExistsSync = existsSync as jest.Mock;
const mockGlob = globWithWorkspaceContextSync as jest.Mock;

describe('detectPlugins', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: only package.json exists, glob returns empty
    mockExistsSync.mockImplementation((path: string) => path === 'package.json');
    mockGlob.mockReturnValue([]);
  });

  it('should not suggest a plugin that is already installed as an npm dependency', async () => {
    const packageJson = {
      name: 'test',
      version: '1.0.0',
      dependencies: { vite: '^5.0.0' },
      devDependencies: { '@nx/vite': '19.0.0' },
    };
    mockReadJsonFile.mockReturnValue(packageJson);

    const result = await detectPlugins({ plugins: [] }, packageJson, false);

    expect(result.plugins).not.toContain('@nx/vite');
  });

  it('should suggest a plugin when the tool is installed but the nx plugin is not', async () => {
    const packageJson = {
      name: 'test',
      version: '1.0.0',
      dependencies: { vite: '^5.0.0' },
      devDependencies: {},
    };
    mockReadJsonFile.mockReturnValue(packageJson);

    const result = await detectPlugins({ plugins: [] }, packageJson, false);

    expect(result.plugins).toContain('@nx/vite');
  });

  it('should not suggest a plugin already listed in nx.json plugins', async () => {
    const packageJson = {
      name: 'test',
      version: '1.0.0',
      dependencies: { vite: '^5.0.0' },
      devDependencies: {},
    };
    mockReadJsonFile.mockReturnValue(packageJson);

    const result = await detectPlugins(
      { plugins: ['@nx/vite'] },
      packageJson,
      false
    );

    expect(result.plugins).not.toContain('@nx/vite');
  });

  describe('Maven detection', () => {
    it('should detect @nx/maven when pom.xml exists at the root (existsSync fallback)', async () => {
      mockExistsSync.mockImplementation(
        (path: string) => path === 'pom.xml' || path === 'package.json'
      );
      mockReadJsonFile.mockReturnValue({ name: 'test', version: '1.0.0' });

      const result = await detectPlugins({}, null, false);

      expect(result.plugins).toContain('@nx/maven');
    });

    it('should detect @nx/maven when mvnw exists at the root (existsSync fallback)', async () => {
      mockExistsSync.mockImplementation(
        (path: string) => path === 'mvnw' || path === 'package.json'
      );
      mockReadJsonFile.mockReturnValue({ name: 'test', version: '1.0.0' });

      const result = await detectPlugins({}, null, false);

      expect(result.plugins).toContain('@nx/maven');
    });

    it('should detect @nx/maven when mvnw.cmd exists at the root (Windows - existsSync fallback)', async () => {
      mockExistsSync.mockImplementation(
        (path: string) => path === 'mvnw.cmd' || path === 'package.json'
      );
      mockReadJsonFile.mockReturnValue({ name: 'test', version: '1.0.0' });

      const result = await detectPlugins({}, null, false);

      expect(result.plugins).toContain('@nx/maven');
    });

    it('should detect @nx/maven when pom.xml is found via glob in subdirectories', async () => {
      mockGlob.mockImplementation((cwd: string, patterns: string[]) => {
        if (patterns.some((p) => p.includes('pom.xml'))) {
          return ['submodule/pom.xml'];
        }
        return [];
      });
      mockExistsSync.mockImplementation(
        (path: string) =>
          path === 'submodule/pom.xml' || path === 'package.json'
      );
      mockReadJsonFile.mockReturnValue({ name: 'test', version: '1.0.0' });

      const result = await detectPlugins({}, null, false);

      expect(result.plugins).toContain('@nx/maven');
    });

    it('should not detect @nx/maven when no Maven files exist', async () => {
      mockExistsSync.mockImplementation((path: string) => path === 'package.json');
      mockGlob.mockReturnValue([]);
      mockReadJsonFile.mockReturnValue({ name: 'test', version: '1.0.0' });

      const result = await detectPlugins({}, null, false);

      expect(result.plugins).not.toContain('@nx/maven');
    });
  });
});
