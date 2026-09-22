import type { Medicine } from '@/types'
import { getApi } from './api'

export const medicinesService = {
  getAll: (): Promise<Medicine[]> => getApi().getMedicines(),
  getById: (id: number): Promise<Medicine> => getApi().getMedicineById(id),
  create: (data: Omit<Medicine, 'id' | 'category' | 'createdAt' | 'updatedAt'>): Promise<Medicine> =>
    getApi().createMedicine(data),
  update: (id: number, data: Partial<Medicine>): Promise<Medicine> =>
    getApi().updateMedicine(id, data),
  delete: (id: number): Promise<void> => getApi().deleteMedicine(id),
}

