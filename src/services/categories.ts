import type { Category } from '@/types'
import { getApi } from './api'

export const categoriesService = {
  getAll: (): Promise<Category[]> => getApi().getCategories(),
  create: (data: { name: string }): Promise<Category> => getApi().createCategory(data),
  update: (id: number, data: { name: string }): Promise<Category> =>
    getApi().updateCategory(id, data),
  delete: (id: number): Promise<void> => getApi().deleteCategory(id),
}

