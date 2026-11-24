import { z } from 'zod';

/** Longest period one report may cover (a full financial year, leap years included). */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 86_400_000;

/** Calendar days from `from` to `to`, both included (YYYY-MM-DD strings). */
export function daysInRange(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD — both dates included, in the shop's local calendar. */
export const dateRangeShape = {
  from: z.iso.date({ error: 'From date must be a valid date (YYYY-MM-DD).' }),
  to: z.iso.date({ error: 'To date must be a valid date (YYYY-MM-DD).' }),
};

/** Refinement for report periods: `to` not before `from`, at most MAX_REPORT_DAYS long. */
export function checkDateRange(range: { from: string; to: string }, ctx: z.RefinementCtx): void {
  const days = daysInRange(range.from, range.to);
  if (days < 1) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'To date cannot be before From date.' });
  } else if (days > MAX_REPORT_DAYS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `A report can cover at most ${MAX_REPORT_DAYS} days. Choose a shorter period.`,
    });
  }
}

export const salesReportQuerySchema = z.object(dateRangeShape).superRefine(checkDateRange);
export type SalesReportQuery = z.infer<typeof salesReportQuerySchema>;

/** Sums over completed bills (cancelled bills are left out). Amounts in rupees. */
export const salesTotalsSchema = z
  .object({
    billCount: z.number().int(),
    quantity: z.number().describe('Pieces / metres sold.'),
    grossAmount: z.number().describe('Value at the selling rate, before discount.'),
    discountTotal: z.number(),
    taxableTotal: z.number(),
    cgstTotal: z.number(),
    sgstTotal: z.number(),
    igstTotal: z.number(),
    gstTotal: z.number().describe('CGST + SGST + IGST.'),
    roundOff: z.number(),
    netSales: z.number().describe('Sum of bill totals (what customers paid).'),
    averageBill: z.number().describe('Net sales ÷ bills (0 when there are no bills).'),
    cash: z.number().describe('Cash received minus change returned.'),
    upi: z.number(),
    card: z.number(),
  })
  .meta({ id: 'SalesTotals' });
export type SalesTotals = z.infer<typeof salesTotalsSchema>;

export const salesDaySchema = z
  .object({ date: z.iso.date(), ...salesTotalsSchema.shape })
  .meta({ id: 'SalesDay' });
export type SalesDay = z.infer<typeof salesDaySchema>;

export const salesReportSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    totals: salesTotalsSchema,
    days: z.array(salesDaySchema).describe('Days that had sales, oldest first.'),
  })
  .meta({ id: 'SalesReport' });
export type SalesReport = z.infer<typeof salesReportSchema>;
