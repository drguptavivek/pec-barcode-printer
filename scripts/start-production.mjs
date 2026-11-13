import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(projectRoot, '.env');
const buildEntry = resolve(projectRoot, 'build', 'index.js');

loadDotEnv(envPath);

process.env.NODE_ENV ??= 'production';

if (!existsSync(buildEntry)) {
	console.error('Production build not found. Run `npm run build` before starting VCMS.');
	process.exit(1);
}

await import(pathToFileURL(buildEntry).href);

function loadDotEnv(path) {
	if (!existsSync(path)) return;

	for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
		if (!match) continue;

		const [, key, rawValue] = match;
		process.env[key] ??= parseDotEnvValue(rawValue);
	}
}

function parseDotEnvValue(value) {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}
