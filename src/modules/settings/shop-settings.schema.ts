import { z } from 'zod';

import {
  checkGstinMatchesState,
  emailField,
  gstinField,
  optionalMobileField,
  optionalText,
  pincodeField,
  requiredText,
  stateField,
} from '../../common/validators/fields.js';

/** Shop details printed on bills. */
export const shopProfileSchema = z
  .object({
    shopName: z.string(),
    phone: z.string(),
    email: z.string(),
    gstNumber: z.string().describe("Shop GSTIN, or ''."),
    address: z.string(),
    city: z.string(),
    state: z.string().describe('Decides CGST + SGST (same state) or IGST on bills.'),
    pincode: z.string(),
  })
  .meta({ id: 'ShopProfile' });
export type ShopProfile = z.infer<typeof shopProfileSchema>;

export const shopProfileInputSchema = z
  .object({
    shopName: requiredText('Shop name', 100),
    phone: optionalMobileField,
    email: emailField,
    gstNumber: gstinField,
    address: optionalText('Address', 250),
    city: optionalText('City', 60),
    state: stateField,
    pincode: pincodeField,
  })
  .superRefine(checkGstinMatchesState)
  .meta({ id: 'ShopProfileInput' });
export type ShopProfileInput = z.infer<typeof shopProfileInputSchema>;
