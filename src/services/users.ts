import type { User, Role } from '@/types'
import { getApi } from './api'

export const usersService = {
  getAll: (): Promise<User[]> => getApi().getUsers(),
  create: (data: { name: string; username: string; password: string; roleId: number }): Promise<User> =>
    getApi().createUser(data),
  update: (id: number, data: Partial<User & { password: string }>): Promise<User> =>
    getApi().updateUser(id, data),
  delete: (id: number): Promise<void> => getApi().deleteUser(id),
}

export const rolesService = {
  getAll: (): Promise<Role[]> => getApi().getRoles(),
  create: (data: { name: string; permissions: object }): Promise<Role> =>
    getApi().createRole(data),
  update: (id: number, data: Partial<Role>): Promise<Role> => getApi().updateRole(id, data),
  delete: (id: number): Promise<void> => getApi().deleteRole(id),
}

