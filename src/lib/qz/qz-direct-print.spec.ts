import { describe, expect, it } from 'vitest';

// Mimics qz-tray.js 2.3: isActive() is false while CONNECTING and a second connect() rejects.
function fakeQz() {
	let state: 'closed' | 'connecting' | 'open' = 'closed';
	const calls = { connect: 0 };
	const qz = {
		security: {
			setCertificatePromise: () => {},
			setSignatureAlgorithm: () => {},
			setSignaturePromise: () => {}
		},
		websocket: {
			isActive: () => state === 'open',
			connect: async () => {
				calls.connect++;
				if (state !== 'closed') throw new Error('An open connection with QZ Tray already exists');
				state = 'connecting';
				await new Promise((r) => setTimeout(r, 5));
				state = 'open';
			}
		},
		printers: {
			find: async () => ['Zebra'],
			getDefault: async () => 'Zebra'
		},
		configs: { create: () => ({}) },
		print: async () => {}
	};
	return { qz, calls };
}

describe('qz-direct-print', () => {
	it('shares one connect attempt between concurrent callers', async () => {
		const { qz, calls } = fakeQz();
		(globalThis as { window?: unknown }).window = { qz };
		const { listQzPrinters, getDefaultQzPrinter } = await import('./qz-direct-print');

		const [printers, defaultPrinter] = await Promise.all([listQzPrinters(), getDefaultQzPrinter()]);

		expect(printers).toEqual(['Zebra']);
		expect(defaultPrinter).toBe('Zebra');
		expect(calls.connect).toBe(1);
	});
});
