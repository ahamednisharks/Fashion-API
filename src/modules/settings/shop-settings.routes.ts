import { type ApiModule, defineRoute } from '../../common/http/route.js';
import { ShopSettingsRepository } from './shop-settings.repository.js';
import { shopProfileInputSchema, shopProfileSchema } from './shop-settings.schema.js';

const repository = new ShopSettingsRepository();

export const shopSettingsModule: ApiModule = {
  basePath: '/settings',
  tag: 'Settings',
  description: 'Shop profile printed on bills (name, address, GSTIN, state).',
  routes: [
    defineRoute({
      method: 'get',
      path: '/shop',
      summary: 'Get the shop profile',
      schemas: {},
      success: { status: 200, description: 'The shop profile.', schema: shopProfileSchema },
      handle: () => repository.get(),
    }),
    defineRoute({
      method: 'put',
      path: '/shop',
      summary: 'Update the shop profile',
      description:
        'Administrators only. Bills already saved keep the details they were printed with.',
      access: 'admin',
      schemas: { body: shopProfileInputSchema },
      success: { status: 200, description: 'The saved shop profile.', schema: shopProfileSchema },
      errors: [400],
      handle: ({ body }) => repository.save(body),
    }),
  ],
};
