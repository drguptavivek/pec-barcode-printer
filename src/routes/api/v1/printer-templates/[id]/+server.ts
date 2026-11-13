import type { RequestHandler } from './$types';
import { withApiHandler } from '$lib/server/api/handler';
import { rateLimitPolicies } from '$lib/server/api/rate-limit';
import { updatePrinterTemplateSchema } from '$lib/server/modules/printer-templates/printer-template.schemas';
import { printerTemplateService } from '$lib/server/modules/printer-templates/printer-template.service';
import { validationFailed } from '$lib/server/observability/errors';

export const PATCH: RequestHandler = (event) =>
	withApiHandler(event, {
		schema: updatePrinterTemplateSchema,
		privilege: 'printer_template.manage',
		rateLimit: rateLimitPolicies.mutation,
		resource: (_body, routeEvent) => ({
			type: 'printer_template',
			id: routeEvent.params.id ?? 'unknown'
		}),
		handler: ({ body, event: routeEvent, userId, requestId }) => {
			const id = Number(routeEvent.params.id);
			if (!Number.isInteger(id) || id <= 0) throw validationFailed({ id: ['Invalid template id.'] });
			return printerTemplateService.update({ ...body, id, userId, requestId });
		}
	});

export const DELETE: RequestHandler = (event) =>
	withApiHandler(event, {
		privilege: 'printer_template.manage',
		rateLimit: rateLimitPolicies.mutation,
		handler: ({ event: routeEvent, userId, requestId }) => {
			const id = Number(routeEvent.params.id);
			if (!Number.isInteger(id) || id <= 0) throw validationFailed({ id: ['Invalid template id.'] });
			return printerTemplateService.delete({ id, userId, requestId });
		}
	});
