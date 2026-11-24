import { type Queryable, pool } from '../../config/database.js';
import type { SalesDay, SalesTotals } from './reports.schema.js';

type SalesRow = SalesDay & { isTotal: boolean };

/**
 * Per-bill amounts with that bill's payments split by mode. Only completed bills count, so
 * cancelled bills (a later feature) drop out of every report automatically.
 */
const COMPLETED_BILLS = `
  SELECT si.invoice_date, si.total_quantity, si.gross_amount, si.discount_total,
         si.taxable_total, si.cgst_total, si.sgst_total, si.igst_total, si.round_off,
         si.grand_total, si.change_returned, pay.cash, pay.upi, pay.card
    FROM sales_invoices si
    CROSS JOIN LATERAL (
      SELECT COALESCE(sum(sp.amount) FILTER (WHERE sp.mode = 'cash'), 0) AS cash,
             COALESCE(sum(sp.amount) FILTER (WHERE sp.mode = 'upi'), 0) AS upi,
             COALESCE(sum(sp.amount) FILTER (WHERE sp.mode = 'card'), 0) AS card
        FROM sales_invoice_payments sp
       WHERE sp.invoice_id = si.id
    ) pay
   WHERE si.status = 'completed'
     AND si.invoice_date BETWEEN $1::date AND $2::date`;

/** Money is summed as NUMERIC in the database, so totals are exact to the paisa. */
const TOTAL_COLUMNS = `
  count(*)::int AS "billCount",
  COALESCE(sum(total_quantity), 0) AS quantity,
  COALESCE(sum(gross_amount), 0) AS "grossAmount",
  COALESCE(sum(discount_total), 0) AS "discountTotal",
  COALESCE(sum(taxable_total), 0) AS "taxableTotal",
  COALESCE(sum(cgst_total), 0) AS "cgstTotal",
  COALESCE(sum(sgst_total), 0) AS "sgstTotal",
  COALESCE(sum(igst_total), 0) AS "igstTotal",
  COALESCE(sum(cgst_total + sgst_total + igst_total), 0) AS "gstTotal",
  COALESCE(sum(round_off), 0) AS "roundOff",
  COALESCE(sum(grand_total), 0) AS "netSales",
  COALESCE(round(sum(grand_total) / NULLIF(count(*), 0), 2), 0) AS "averageBill",
  -- Change is always paid back in cash (UPI / card can never exceed the bill).
  COALESCE(sum(cash) - sum(change_returned), 0) AS cash,
  COALESCE(sum(upi), 0) AS upi,
  COALESCE(sum(card), 0) AS card`;

export class ReportsRepository {
  constructor(private readonly db: Queryable = pool) {}

  /**
   * Sales per day (days without bills are skipped) plus the grand total of the period, in one
   * pass: ROLLUP adds the total row, which exists even when the period has no bills.
   */
  async salesByDay(from: string, to: string): Promise<{ totals: SalesTotals; days: SalesDay[] }> {
    const result = await this.db.query<SalesRow>(
      `WITH bills AS (${COMPLETED_BILLS})
       SELECT invoice_date::text AS date, GROUPING(invoice_date) = 1 AS "isTotal",
              ${TOTAL_COLUMNS}
         FROM bills
        GROUP BY ROLLUP (invoice_date)
        ORDER BY invoice_date NULLS LAST`,
      [from, to],
    );
    const days: SalesDay[] = [];
    let totals: SalesTotals | null = null;
    for (const { isTotal, date, ...amounts } of result.rows) {
      if (isTotal) {
        totals = amounts;
      } else {
        days.push({ date, ...amounts });
      }
    }
    return { totals: totals ?? emptyTotals(), days };
  }
}

export function emptyTotals(): SalesTotals {
  return {
    billCount: 0,
    quantity: 0,
    grossAmount: 0,
    discountTotal: 0,
    taxableTotal: 0,
    cgstTotal: 0,
    sgstTotal: 0,
    igstTotal: 0,
    gstTotal: 0,
    roundOff: 0,
    netSales: 0,
    averageBill: 0,
    cash: 0,
    upi: 0,
    card: 0,
  };
}
