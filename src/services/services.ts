import type { Service } from '@/types'
import { getApi } from './api'

export const servicesService = {
  getAll: (): Promise<Service[]> => getApi().getServices(),
  create: (data: Omit<Service, 'id' | 'createdAt' | 'updatedAt'>): Promise<Service> =>
    getApi().createService(data),
  update: (id: number, data: Partial<Service>): Promise<Service> =>
    getApi().updateService(id, data),
  delete: (id: number): Promise<void> => getApi().deleteService(id),
}

