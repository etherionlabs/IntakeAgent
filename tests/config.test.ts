import { describe, it, expect } from 'vitest';
import { loadConfig, loadProfile, ConfigCache, ConfigLoadError } from '../src/config/loader';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validConfig = {
  profile: './profiles/tapiceria',
  owner: { phoneE164: '+5215555555555' },
};

async function makeTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `intake-test-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('loadConfig', () => {
  it('carga y aplica defaults', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify(validConfig));
    const cfg = await loadConfig(path);
    expect(cfg.maxSteps).toBe(6);
    expect(cfg.debounceMs).toBe(5000);
    await rm(dir, { recursive: true });
  });

  it('falla con JSON inválido', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, '{ not json');
    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await rm(dir, { recursive: true });
  });

  it('falla si falta owner', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ profile: './x' }));
    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await rm(dir, { recursive: true });
  });
});

describe('loadProfile', () => {
  it('carga el perfil tapiceria del repo', async () => {
    const profile = await loadProfile('./profiles/tapiceria');
    expect(profile.intakeSchema.$businessName).toBe('Tapicería Demo');
    expect(profile.welcome).toMatch(/asistente/i);
    expect(profile.hash).toHaveLength(12);
  });
});

describe('ConfigCache', () => {
  it('mantiene última versión válida cuando hay error posterior', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ ...validConfig, profile: './profiles/tapiceria' }));
    const warnings: string[] = [];
    const cache = new ConfigCache(path, { warn: (m) => warnings.push(m) });
    const first = await cache.refresh();
    expect(first.config.model).toBeDefined();
    await writeFile(path, '{ broken json');
    const second = await cache.refresh();
    expect(second.config.model).toBe(first.config.model);
    expect(warnings.length).toBe(1);
    await rm(dir, { recursive: true });
  });
});
