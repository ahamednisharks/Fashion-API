import { MasterService } from '../../common/crud/master.service.js';
import { SuppliersRepository } from './suppliers.repository.js';
import type { Supplier, SupplierInput, SupplierListQuery } from './suppliers.schema.js';

/**
 * Suppliers are not referenced by other tables yet. When purchase entries are added, override
 * `assertDeletable` so suppliers with purchases can only be deactivated.
 */
export class SuppliersService extends MasterService<Supplier, SupplierInput, SupplierListQuery> {
  constructor(suppliers = new SuppliersRepository()) {
    super(suppliers, 'Supplier');
  }
}

export const suppliersService = new SuppliersService();
