import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
	copyFile,
	mkdir,
	realpath,
	readdir,
	stat,
	writeFile,
	unlink,
	rename
} from 'node:fs/promises';
import { ZipArchive } from 'archiver';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const includes = [];
let destination = join(root, 'backups');
for (let i = 0; i < args.length; i++) {
	if (!['--output', '--include'].includes(args[i]) || !args[i + 1]) {
		throw new Error('Usage: npm run backup -- [--output DIRECTORY] [--include FILE_OR_DIRECTORY]');
	}
	const option = args[i++];
	if (option === '--output') destination = resolve(args[i]);
	else includes.push(resolve(args[i]));
}
const folder = join(
	destination,
	new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid
);
const records = [];
const skip = new Set([
	'.git',
	'node_modules',
	'build',
	'.svelte-kit',
	'backups',
	'restore-input',
	'logs',
	'vendor',
	'tmp',
	'temp',
	'.pm2-vcms'
]);

async function capture(source, target) {
	const info = await stat(source);
	if (info.isDirectory()) {
		for (const item of await readdir(source, { withFileTypes: true })) {
			if (!item.isSymbolicLink()) await capture(join(source, item.name), join(target, item.name));
		}
	} else if (info.isFile()) {
		await mkdir(dirname(target), { recursive: true, mode: 0o700 });
		await copyFile(source, target);
		await record(target);
	}
}

async function optional(source, target) {
	try {
		await stat(source);
	} catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}
	await capture(source, target);
}

async function record(file) {
	const hash = createHash('sha256');
	let bytes = 0;
	for await (const chunk of createReadStream(file)) {
		hash.update(chunk);
		bytes += chunk.length;
	}
	records.push({
		file: relative(folder, file).replaceAll('\\', '/'),
		bytes,
		sha256: hash.digest('hex')
	});
}

async function dump(service, command, filename) {
	const file = join(folder, filename);
	const child = spawn('docker', ['compose', 'exec', '-T', service, 'sh', '-c', command], {
		cwd: root,
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr = (stderr + chunk).slice(-4000);
	});
	const completion = new Promise((accept, reject) => {
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? accept() : reject(new Error(`${service} backup failed (${code}): ${stderr}`))
		);
	});
	await Promise.all([completion, pipeline(child.stdout, createWriteStream(file, { mode: 0o600 }))]);
	if ((await stat(file)).size === 0) throw new Error(`Empty backup: ${filename}`);
	await record(file);
	console.log(`Saved ${filename}`);
}

async function findKeys(directory) {
	for (const item of await readdir(directory, { withFileTypes: true })) {
		if (skip.has(item.name) || item.isSymbolicLink() || item.name.startsWith('.pm2')) continue;
		const file = join(directory, item.name);
		if (resolve(file) === resolve(destination)) continue;
		if (item.isDirectory()) await findKeys(file);
		else if (
			/\.(pem|key|p12|pfx|jks|crt|cer)$/i.test(item.name) ||
			item.name === '.env' ||
			item.name.startsWith('.env.')
		) {
			await capture(file, join(folder, 'project', relative(root, file)));
		}
	}
}

try {
	await mkdir(folder, { recursive: true, mode: 0o700 });
	await writeFile(
		join(folder, 'INCOMPLETE'),
		'Backup has not completed. Do not use for recovery.\n',
		{ mode: 0o600 }
	);
	console.log(`Backup destination: ${folder}`);
	console.log('Contains credentials and keys. Store securely; this backup is not encrypted.');
	await dump('db', 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc', 'vcms.dump');
	await dump(
		'db',
		'exec pg_dumpall -U "$POSTGRES_USER" -l "$POSTGRES_DB" --globals-only',
		'vcms-roles.sql'
	);
	await dump('ehrbase-db', 'exec pg_dump -U postgres -d ehrbase -Fc', 'ehrbase.dump');
	await dump(
		'ehrbase-db',
		'exec pg_dumpall -U postgres -l ehrbase --globals-only',
		'ehrbase-roles.sql'
	);
	await findKeys(root);
	for (const name of [
		'compose.yaml',
		'ecosystem.config.cjs',
		'package.json',
		'package-lock.json',
		'.gitmodules',
		'WINDOWS.txt'
	]) {
		await optional(join(root, name), join(folder, 'project', name));
	}
	await capture(join(root, 'scripts'), join(folder, 'project', 'scripts'));
	const pm2Home =
		process.env.PM2_HOME ||
		(process.platform === 'win32' && process.env.LOCALAPPDATA
			? join(process.env.LOCALAPPDATA, 'vcms-pm2')
			: join(homedir(), '.pm2'));
	for (const name of ['dump.pm2', 'dump.pm2.bak', 'module_conf.json']) {
		await optional(join(pm2Home, name), join(folder, 'pm2', name));
	}
	for (let i = 0; i < includes.length; i++) {
		const source = await realpath(includes[i]);
		const nested = relative(source, await realpath(folder));
		if (
			nested === '' ||
			(!isAbsolute(nested) && nested !== '..' && !nested.startsWith(`..${sep}`))
		) {
			throw new Error('--include must not contain the backup destination');
		}
		await capture(source, join(folder, 'extra', String(i + 1)));
	}
	await writeFile(
		join(folder, 'manifest.json'),
		JSON.stringify(
			{
				createdAt: new Date().toISOString(),
				format: 1,
				encrypted: false,
				databases: ['vcms.dump', 'ehrbase.dump'],
				extraSources: includes,
				files: records
			},
			null,
			2
		),
		{ mode: 0o600 }
	);
	await unlink(join(folder, 'INCOMPLETE'));
	const archive = new ZipArchive({ zlib: { level: 6 } });
	archive.on('warning', (error) => archive.destroy(error));
	const zipped = pipeline(archive, createWriteStream(`${folder}.zip.partial`, { mode: 0o600 }));
	archive.directory(folder, false);
	await Promise.all([zipped, archive.finalize()]);
	await rename(`${folder}.zip.partial`, `${folder}.zip`);
	console.log(`Backup complete: ${folder}.zip`);
	console.log(`Uncompressed recovery copy retained: ${folder}`);
} catch (error) {
	await writeFile(join(folder, 'INCOMPLETE'), 'Backup failed. Do not use for recovery.\n', {
		mode: 0o600
	}).catch(() => {});
	console.error(`Backup FAILED: ${error.message}`);
	console.error(`Partial output retained at ${folder}; INCOMPLETE marks an unusable backup.`);
	process.exitCode = 1;
}
