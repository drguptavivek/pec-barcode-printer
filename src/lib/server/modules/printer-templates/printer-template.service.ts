import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { printerTemplates } from '$lib/server/db/schema';
import { writeAudit } from '$lib/server/observability/audit';
import { notFound } from '$lib/server/observability/errors';

export class PrinterTemplateService {
	list() {
		return db
			.select()
			.from(printerTemplates)
			.where(eq(printerTemplates.active, true))
			.orderBy(asc(printerTemplates.name));
	}

	async create(input: {
		name: string;
		type: 'html_pdf' | 'zpl' | 'epl';
		widthMm: number;
		heightMm: number;
		dpi: number;
		barcodeHeight: number;
		layout: Record<string, unknown>;
		userId: string;
		requestId: string;
	}) {
		const [template] = await db
			.insert(printerTemplates)
			.values({
				name: input.name,
				type: input.type,
				widthMm: input.widthMm,
				heightMm: input.heightMm,
				dpi: input.dpi,
				barcodeHeight: input.barcodeHeight,
				layout: input.layout,
				createdBy: input.userId
			})
			.returning();
		await writeAudit(db, {
			requestId: input.requestId,
			actorUserId: input.userId,
			action: 'printer_template.manage',
			resourceType: 'printer_template',
			resourceId: template.id,
			after: template
		});
		return template;
	}

	async update(input: {
		id: number;
		name: string;
		type: 'html_pdf' | 'zpl' | 'epl';
		widthMm: number;
		heightMm: number;
		dpi: number;
		barcodeHeight: number;
		layout: Record<string, unknown>;
		userId: string;
		requestId: string;
	}) {
		const [before] = await db
			.select()
			.from(printerTemplates)
			.where(eq(printerTemplates.id, input.id));
		if (!before) throw notFound('Printer template was not found.');

		const [template] = await db
			.update(printerTemplates)
			.set({
				name: input.name,
				type: input.type,
				widthMm: input.widthMm,
				heightMm: input.heightMm,
				dpi: input.dpi,
				barcodeHeight: input.barcodeHeight,
				layout: input.layout,
				updatedAt: new Date()
			})
			.where(eq(printerTemplates.id, input.id))
			.returning();

		await writeAudit(db, {
			requestId: input.requestId,
			actorUserId: input.userId,
			action: 'printer_template.manage',
			resourceType: 'printer_template',
			resourceId: template.id,
			before,
			after: template
		});
		return template;
	}

	async delete(input: { id: number; userId: string; requestId: string }) {
		const [before] = await db
			.select()
			.from(printerTemplates)
			.where(eq(printerTemplates.id, input.id));
		if (!before || !before.active) throw notFound('Printer template was not found.');

		const [template] = await db
			.update(printerTemplates)
			.set({
				active: false,
				updatedAt: new Date()
			})
			.where(eq(printerTemplates.id, input.id))
			.returning();

		await writeAudit(db, {
			requestId: input.requestId,
			actorUserId: input.userId,
			action: 'printer_template.manage',
			resourceType: 'printer_template',
			resourceId: template.id,
			before,
			after: template,
			reason: 'Soft delete printer template'
		});
		return template;
	}
}

export const printerTemplateService = new PrinterTemplateService();
