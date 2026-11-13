<script lang="ts">
	import { getDefaultQzPrinter, listQzPrinters, printRawBarcode } from '$lib/qz/qz-direct-print';

	let { data } = $props();
	let message = $state('');
	let qzMessage = $state('');
	let qzBusy = $state(false);
	let qzPrinters = $state<string[]>([]);
	let selectedQzPrinter = $state('');
	let selectedType = $state<'html_pdf' | 'zpl' | 'epl'>('zpl');
	let editingTemplate = $state<(typeof data.templates)[number] | null>(null);

	const fieldHelp = {
		html_pdf: {
			type: 'Browser/PDF templates render in the browser print view instead of sending raw printer commands.',
			widthMm: 'Physical label width used by browser print layout.',
			heightMm: 'Physical label height used by browser print layout.',
			dpi: 'DPI is kept for consistency; browser output is mainly controlled by CSS and printer paper settings.',
			barcodeHeight: 'Browser/PDF barcode sizing is rendered as SVG; use this only when matching template records.',
			barcodeX: 'Raw-printer dot positioning is not used by Browser/PDF output.',
			barcodeY: 'Raw-printer dot positioning is not used by Browser/PDF output.',
			textY: 'Raw-printer dot positioning is not used by Browser/PDF output.'
		},
		zpl: {
			type: 'ZPL is for Zebra raw printing through QZ Tray. Current tested stock is 50x25 mm thermal transfer.',
			widthMm: 'Physical sticker width. 50 mm becomes `^PW400` on a 203 DPI Zebra.',
			heightMm: 'Physical sticker height. 25 mm becomes `^LL200`; keep this as the full label height.',
			dpi: 'Printer resolution. Zebra ZD230 203 DPI should stay at `203`.',
			barcodeHeight: 'Barcode bar height in dots. `58` fits the tested 50x25 mm thermal-transfer layout.',
			barcodeX: 'Left offset in dots. Around `33` centers the VCMS barcode on 50 mm labels.',
			barcodeY: 'Top offset in dots. Use `16` for the tested label; increase for more top margin.',
			textY: 'Human-readable text top offset in dots. `88` keeps text below the barcode on one sticker.'
		},
		epl: {
			type: 'EPL is for Eltron/Zebra-compatible raw printers using EPL commands.',
			widthMm: 'Physical sticker width converted to EPL `q` width dots.',
			heightMm: 'Physical sticker height converted to EPL `Q` label length.',
			dpi: 'Printer resolution used for mm-to-dot conversion. Common EPL printers are 203 DPI.',
			barcodeHeight: 'EPL barcode height in dots for the `B` command.',
			barcodeX: 'Left offset in dots for the EPL barcode and text commands.',
			barcodeY: 'Top offset in dots for the EPL barcode command.',
			textY: 'Top offset in dots for the EPL human-readable text command.'
		}
	} satisfies Record<
		'html_pdf' | 'zpl' | 'epl',
		Record<'type' | 'widthMm' | 'heightMm' | 'dpi' | 'barcodeHeight' | 'barcodeX' | 'barcodeY' | 'textY', string>
	>;

	const helpText = $derived(fieldHelp[selectedType]);
	const formTitle = $derived(editingTemplate ? 'Edit Template' : 'Create Template');
	const submitLabel = $derived(editingTemplate ? 'Save Changes' : 'Create');

	async function saveTemplate(event: SubmitEvent) {
		event.preventDefault();
		const form = new FormData(event.currentTarget as HTMLFormElement);
		const payload = {
			name: String(form.get('name')),
			type: form.get('type'),
			widthMm: Number(form.get('widthMm')),
			heightMm: Number(form.get('heightMm')),
			dpi: Number(form.get('dpi')),
			barcodeHeight: Number(form.get('barcodeHeight')),
			layout: {
				barcodeX: Number(form.get('barcodeX')),
				barcodeY: Number(form.get('barcodeY')),
				textY: Number(form.get('textY'))
			}
		};
		const url = editingTemplate
			? `/api/v1/printer-templates/${editingTemplate.id}`
			: '/api/v1/printer-templates';
		const response = await fetch(url, {
			method: editingTemplate ? 'PATCH' : 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (response.ok) location.reload();
		else message = (await response.json()).error?.message ?? 'Failed to save template.';
	}

	function editTemplate(template: (typeof data.templates)[number]) {
		editingTemplate = template;
		selectedType = template.type;
		message = '';
	}

	function cancelEdit() {
		editingTemplate = null;
		selectedType = 'zpl';
		message = '';
	}

	async function deleteTemplate(template: (typeof data.templates)[number]) {
		if (!confirm(`Delete printer template "${template.name}"? Existing print history will be kept.`)) return;
		const response = await fetch(`/api/v1/printer-templates/${template.id}`, {
			method: 'DELETE'
		});
		if (response.ok) location.reload();
		else message = (await response.json()).error?.message ?? 'Failed to delete template.';
	}

	function layoutNumber(template: (typeof data.templates)[number] | null, key: string, fallback: number) {
		const value = (template?.layout as Record<string, unknown> | undefined)?.[key];
		return typeof value === 'number' ? value : fallback;
	}

	async function loadQzPrinters() {
		qzBusy = true;
		qzMessage = 'Checking QZ Tray printers...';
		try {
			const [printers, defaultPrinter] = await Promise.all([
				listQzPrinters(),
				getDefaultQzPrinter().catch(() => '')
			]);
			qzPrinters = printers;
			selectedQzPrinter = selectedQzPrinter || defaultPrinter || printers[0] || '';
			qzMessage = printers.length
				? 'QZ Tray printers loaded.'
				: 'QZ Tray is reachable, but no printers were reported.';
		} catch (error) {
			qzMessage = error instanceof Error ? error.message : 'QZ Tray printer lookup failed.';
		} finally {
			qzBusy = false;
		}
	}

	async function testTemplate(template: (typeof data.templates)[number]) {
		if (template.type !== 'zpl' && template.type !== 'epl') {
			qzMessage = 'QZ test printing is available for ZPL and EPL templates only.';
			return;
		}
		if (!selectedQzPrinter) {
			qzMessage = 'Select a QZ printer before testing a template.';
			return;
		}
		qzBusy = true;
		qzMessage = `Sending ${template.type.toUpperCase()} test to ${selectedQzPrinter}...`;
		try {
			await printRawBarcode({
				printerName: selectedQzPrinter,
				language: template.type,
				data: renderSampleBarcode(template),
				jobName: `VCMS ${template.name} test`
			});
			qzMessage = `Sent ${template.name} test to ${selectedQzPrinter}.`;
		} catch (error) {
			qzMessage = error instanceof Error ? error.message : 'QZ template test failed.';
		} finally {
			qzBusy = false;
		}
	}

	function renderSampleBarcode(template: (typeof data.templates)[number]) {
		const sampleBarcode = '04-26-000002';
		const widthDots = mmToDots(template.widthMm, template.dpi);
		const heightDots = mmToDots(template.heightMm, template.dpi);
		const x = layoutNumber(template, 'barcodeX', 33);
		const y = layoutNumber(template, 'barcodeY', 16);
		const textY = layoutNumber(template, 'textY', 88);
		const { moduleWidth } = barcodeGeometry(sampleBarcode, widthDots);
		if (template.type === 'zpl') {
			return [
				'^XA',
				'^CI28',
				'^MNY',
				'^MMT',
				'^MTT',
				'^MD20',
				'^PR2',
				'^LT0',
				'^LS0',
				`^PW${widthDots}`,
				`^LL${heightDots}`,
				`^BY${moduleWidth},2,${template.barcodeHeight}`,
				`^FO${x},${y}^BCN,${template.barcodeHeight},N,N,N`,
				`^FD${sampleBarcode}^FS`,
				`^FO${x},${textY}^A0N,24,24^FD${sampleBarcode}^FS`,
				'^XZ'
			].join('\r\n');
		}
		return [
			'N',
			`q${widthDots}`,
			`Q${heightDots},24`,
			`B${x},${y},0,1,${moduleWidth},${moduleWidth * 2},${template.barcodeHeight},N,"${sampleBarcode}"`,
			`A${x},${textY},0,3,1,1,N,"${sampleBarcode}"`,
			'P1'
		].join('\r\n');
	}

	function mmToDots(mm: number, dpi: number) {
		return Math.round((mm / 25.4) * dpi);
	}

	function barcodeGeometry(value: string, widthDots: number) {
		const modules = 35 + value.length * 11;
		const moduleWidth = modules * 2 <= widthDots ? 2 : 1;
		return { moduleWidth };
	}
</script>

<h1>Printer Templates</h1>
<section class="card">
	<h2>{formTitle}</h2>
	{#if message}<p class="error">{message}</p>{/if}
	<form class="grid" onsubmit={saveTemplate}>
		<label>
			Name
			<input name="name" value={editingTemplate?.name ?? '50x25 ZPL Thermal Transfer'} required />
			<span class="hint">Use a name that includes stock size, printer language, and mode.</span>
		</label>
		<label>
			Type
			<select name="type" bind:value={selectedType}>
				<option value="html_pdf">Browser/PDF</option>
				<option value="zpl">ZPL</option>
				<option value="epl">EPL</option>
			</select>
			<span class="hint">{helpText.type}</span>
		</label>
		<label>
			Width mm
			<input name="widthMm" type="number" value={editingTemplate?.widthMm ?? 50} required />
			<span class="hint">{helpText.widthMm}</span>
		</label>
		<label>
			Height mm
			<input name="heightMm" type="number" value={editingTemplate?.heightMm ?? 25} required />
			<span class="hint">{helpText.heightMm}</span>
		</label>
		<label>
			DPI
			<input name="dpi" type="number" value={editingTemplate?.dpi ?? 203} required />
			<span class="hint">{helpText.dpi}</span>
		</label>
		<label>
			Barcode Height
			<input name="barcodeHeight" type="number" value={editingTemplate?.barcodeHeight ?? 58} required />
			<span class="hint">{helpText.barcodeHeight}</span>
		</label>
		<label>
			Barcode X
			<input name="barcodeX" type="number" value={layoutNumber(editingTemplate, 'barcodeX', 33)} />
			<span class="hint">{helpText.barcodeX}</span>
		</label>
		<label>
			Barcode Y
			<input name="barcodeY" type="number" value={layoutNumber(editingTemplate, 'barcodeY', 16)} />
			<span class="hint">{helpText.barcodeY}</span>
		</label>
		<label>
			Text Y
			<input name="textY" type="number" value={layoutNumber(editingTemplate, 'textY', 88)} />
			<span class="hint">{helpText.textY}</span>
		</label>
		<div class="actions">
			<button type="submit">{submitLabel}</button>
			{#if editingTemplate}
				<button type="button" class="secondary" onclick={cancelEdit}>Cancel</button>
			{/if}
		</div>
	</form>
</section>
<section class="card">
	<div class="qz-toolbar">
		<label>
			QZ Printer
			<select bind:value={selectedQzPrinter}>
				<option value="">Select printer</option>
				{#each qzPrinters as printer (printer)}
					<option value={printer}>{printer}</option>
				{/each}
			</select>
		</label>
		<button type="button" class="secondary" disabled={qzBusy} onclick={loadQzPrinters}>
			Find QZ Printers
		</button>
	</div>
	{#if qzMessage}<p class="hint">{qzMessage}</p>{/if}
	<table>
		<thead>
			<tr><th>Name</th><th>Type</th><th>Size</th><th>DPI</th><th>Actions</th></tr>
		</thead>
		<tbody>
			{#each data.templates as template (template.id)}
				<tr>
					<td>{template.name}</td>
					<td>{template.type}</td>
					<td>{template.widthMm} x {template.heightMm} mm</td>
					<td>{template.dpi}</td>
					<td>
						<div class="row-actions">
							<button type="button" class="secondary" onclick={() => editTemplate(template)}>Edit</button>
							<button
								type="button"
								class="secondary"
								disabled={qzBusy || template.type === 'html_pdf'}
								onclick={() => testTemplate(template)}>Test</button
							>
							<button type="button" class="danger" onclick={() => deleteTemplate(template)}>Delete</button>
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.hint {
		display: block;
		margin-top: 0.25rem;
		color: #5f6b7a;
		font-size: 0.85rem;
		line-height: 1.35;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.qz-toolbar,
	.row-actions {
		display: flex;
		gap: 0.75rem;
		align-items: end;
		flex-wrap: wrap;
	}

	.qz-toolbar {
		margin-bottom: 1rem;
	}

	.danger {
		border-color: #b42318;
		color: #b42318;
	}
</style>
