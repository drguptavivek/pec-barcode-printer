---
title: Printer Templates API Blueprint
status: draft
owner: engineering
last_reviewed: 2026-05-07
---

# Printer Templates API Blueprint

## Routes

- `GET /api/v1/printer-templates`
- `POST /api/v1/printer-templates`
- `PATCH /api/v1/printer-templates/{id}`
- `DELETE /api/v1/printer-templates/{id}`

Both routes require `printer_template.manage` in the current implementation.

## Create Template

Request:

```json
{
	"name": "ZPL 50x25 203dpi",
	"type": "zpl",
	"widthMm": 50,
	"heightMm": 25,
	"dpi": 203,
	"barcodeHeight": 80,
	"layout": {
		"barcodeX": 40,
		"barcodeY": 24,
		"textY": 120
	}
}
```

`DELETE` soft-deletes a template by marking it inactive. Existing barcode batches keep their historical template reference.
