import type { PrinterTemplateConfig } from '../barcode.types';

const mmToDots = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);
const code128Modules = (value: string) => 35 + value.length * 11;

function barcodeGeometry(value: string, widthDots: number, preferredX?: number) {
	const modules = code128Modules(value);
	const moduleWidth = modules * 2 <= widthDots ? 2 : 1;
	const barcodeWidth = modules * moduleWidth;
	const centeredX = Math.max(0, Math.floor((widthDots - barcodeWidth) / 2));
	return {
		x: preferredX ?? centeredX,
		moduleWidth
	};
}

export function renderZpl(barcodes: string[], template: PrinterTemplateConfig) {
	const widthDots = mmToDots(template.widthMm, template.dpi);
	const heightDots = mmToDots(template.heightMm, template.dpi);
	const compactLabel = template.heightMm <= 25;
	const y = compactLabel ? 16 : (template.layout.barcodeY ?? 24);
	const barcodeHeight = compactLabel ? Math.min(template.barcodeHeight, 58) : template.barcodeHeight;
	const textY = compactLabel ? 88 : (template.layout.textY ?? y + barcodeHeight + 12);
	const textSize = compactLabel ? 24 : 28;

	return barcodes
		.map(
			(value) => {
				const { x, moduleWidth } = barcodeGeometry(value, widthDots, template.layout.barcodeX);
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
					`^BY${moduleWidth},2,${barcodeHeight}`,
					`^FO${x},${y}^BCN,${barcodeHeight},N,N,N`,
					`^FD${value}^FS`,
					`^FO${x},${textY}^A0N,${textSize},${textSize}^FD${value}^FS`,
					'^XZ'
				].join('\r\n');
			}
		)
		.join('\r\n');
}
