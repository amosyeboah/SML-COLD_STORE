import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User) => void
  logout: () => void
}

// Migrate legacy auth session if available
if (typeof window !== 'undefined' && !localStorage.getItem('sml-coldstore-auth')) {
  const oldAuth = localStorage.getItem('pharmacy-auth')
  if (oldAuth) {
    localStorage.setItem('sml-coldstore-auth', oldAuth)
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      login: (user) => set({ user, isAuthenticated: true }),
      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'sml-coldstore-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
)
