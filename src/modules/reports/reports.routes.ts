import { type ApiModule, defineRoute } from '../../common/http/route.js';
import { ReportsRepository } from './reports.repository.js';
import { type SalesReport, salesReportQuerySchema, salesReportSchema } from './reports.schema.js';

const repository = new ReportsRepository();

export const reportsModule: ApiModule = {
  basePath: '/reports',
  tag: 'Reports',
  access: 'admin',
  description:
    'Business reports (administrators only). Dates are the shop-local (IST) bill dates; ' +
    'both ends of a period are included and a period can be at most 366 days.',
  routes: [
    defineRoute({
      method: 'get',
      path: '/sales',
      summary: 'Sales summary for a period, day by day',
      description:
        'Totals of completed bills: count, quantity, discount, taxable value, GST, net sales ' +
        'and the payment split (cash is net of change returned). `days` lists only days that ' +
        'had sales.',
      schemas: { query: salesReportQuerySchema },
      success: { status: 200, description: 'The sales report.', schema: salesReportSchema },
      errors: [400],
      handle: async ({ query }): Promise<SalesReport> => ({
        from: query.from,
        to: query.to,
        ...(await repository.salesByDay(query.from, query.to)),
      }),
    }),
  ],
};
