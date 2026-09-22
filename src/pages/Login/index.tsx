import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Lock, User, Eye, EyeOff, Loader2, Grid3x3, Users, Link2, Package, Shield, Snowflake, ShoppingCart } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { api } from '@/services/api'

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})
type FormData = z.infer<typeof schema>

const features = [
  { icon: Package, title: 'Cold Room & Batch Tracking', description: 'Monitor cartons, batch lots, and expiry shelf life with ease.' },
  { icon: ShoppingCart, title: 'Fast POS Checkout', description: 'Process wholesale and retail sales with cash, momo, and thermal receipts.' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loginMode, setLoginMode] = useState<'credentials' | 'pin'>('credentials')

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const fillRole = (username: string, pass: string) => {
    setValue('username', username)
    setValue('password', pass)
    setError(null)
  }

  const onSubmit = async (data: FormData) => {
    setError(null)
    try {
      const apiClient = typeof window !== 'undefined' && window.api ? window.api : api
      const user = await apiClient.login(data.username, data.password)
      login(user)
      navigate('/dashboard')
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Invalid username or password')
    }
  }

  return (
    <div className="flex h-[100dvh] w-full bg-[#f3f5f9] font-sans overflow-hidden">
      {/* Left Column */}
      <div className="hidden lg:flex flex-col justify-between w-[55%] max-w-[800px] bg-gradient-to-br from-[#2563EB] to-[#0284C7] p-8 lg:p-12 rounded-r-[2rem] text-white shadow-xl z-10">
        
        <div className="flex flex-col gap-6 lg:gap-8 max-w-[500px] flex-1 justify-center">
          {/* Logo & Branding */}
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 shadow-md">
              <Snowflake className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-100">SML LEGACY LIMITED</p>
              <p className="text-sm font-semibold mt-0.5">Quality Frozen Foods &amp; Cold Storage</p>
            </div>
          </div>

          {/* Main Heading */}
          <div className="mt-4 lg:mt-8">
            <h1 className="text-3xl lg:text-4xl font-bold leading-[1.15] mb-3">
              Welcome back to your<br />cold store command center.
            </h1>
            <p className="text-sm lg:text-[15px] leading-relaxed text-blue-100/90 max-w-[420px]">
              Manage cold room inventory, track carton batches and shelf life,
              process fast POS transactions, and keep your wholesale and retail
              sales synchronized.
            </p>
          </div>

          {/* Feature Cards */}
          <div className="space-y-4 pt-4">
            {features.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-2xl border border-white/20 bg-white/10 p-5 flex items-start gap-5 backdrop-blur-sm">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20">
                  <Icon className="h-5 w-5 text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white mb-1">{title}</h3>
                  <p className="text-[13px] text-blue-100/90">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Badge */}
        <div className="mt-8 inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-5 py-2 text-[12px] font-medium backdrop-blur-sm w-fit">
          <Shield className="h-4 w-4" />
          Offline-ready and secure for daily cold store operations
        </div>
      </div>

      {/* Right Column */}
      <div className="flex-1 flex flex-col relative h-full">
        <div className="flex-1 flex flex-col items-center justify-center p-4 lg:p-8 overflow-y-auto">
          <div className="w-full max-w-[360px]">
            {/* Header */}
            <div className="text-center mb-5">
              <h2 className="text-[28px] font-bold text-gray-900 mb-1">Welcome Back!</h2>
              <p className="text-xs text-gray-500 mb-3">Sign in to SML Legacy Cold Store POS</p>

              {/* Quick Role Fill Chips */}
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => fillRole('admin', 'admin123')}
                  className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  Admin
                </button>
                <button
                  type="button"
                  onClick={() => fillRole('manager', 'manager123')}
                  className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  Manager
                </button>
                <button
                  type="button"
                  onClick={() => fillRole('cashier', 'cashier123')}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  Cashier
                </button>
              </div>
            </div>

            {loginMode === 'credentials' ? (
              <>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                  {/* Username */}
                  <div className="space-y-2">
                    <Label className="text-[13px] font-semibold text-gray-700">Username</Label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400" />
                      <Input
                        {...register('username')}
                        placeholder="Enter your username"
                        className="h-12 border-gray-200 bg-white pl-11 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-blue-500/20 shadow-sm rounded-lg"
                        autoComplete="username"
                      />
                    </div>
                    {errors.username && <p className="text-xs text-red-500">{errors.username.message}</p>}
                  </div>

                  {/* Password */}
                  <div className="space-y-2">
                    <Label className="text-[13px] font-semibold text-gray-700">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-400" />
                      <Input
                        {...register('password')}
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        className="h-12 border-gray-200 bg-white pl-11 pr-11 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-blue-500/20 shadow-sm rounded-lg"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
                      >
                        {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                    {errors.password && <p className="text-xs text-red-500">{errors.password.message}</p>}
                  </div>

                  <div className="flex justify-end">
                    <a href="#" className="text-[13px] font-semibold text-blue-600 hover:text-blue-700">
                      Forgot password?
                    </a>
                  </div>

                  {error && (
                    <div className="rounded-lg bg-red-50 p-3 text-[13px] text-red-600 border border-red-100 text-center">
                      {error}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="h-11 w-full bg-[#2563EB] text-[15px] font-semibold text-white hover:bg-blue-700 shadow-sm flex items-center justify-center gap-2 rounded-lg"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-[18px] w-[18px] animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <Users className="h-[18px] w-[18px]" />
                        Sign In
                      </>
                    )}
                  </Button>
                </form>

                <div className="my-5 flex items-center gap-4">
                  <div className="h-px flex-1 bg-gray-200"></div>
                  <span className="text-[11px] font-semibold text-gray-400">OR</span>
                  <div className="h-px flex-1 bg-gray-200"></div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLoginMode('pin')}
                  className="h-11 w-full border-gray-200 bg-white text-[14px] font-semibold text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 rounded-lg shadow-sm"
                >
                  <Grid3x3 className="h-4 w-4 text-gray-500" />
                  Login with PIN
                </Button>
              </>
            ) : (
              <div className="space-y-6">
                <p className="text-center text-sm text-gray-600">Enter your 4-digit PIN to login</p>
                <div className="flex gap-3 justify-center">
                  {[1, 2, 3, 4].map((i) => (
                    <input
                      key={i}
                      type="password"
                      maxLength={1}
                      className="h-14 w-12 border-gray-200 bg-white rounded-lg text-center text-2xl font-bold text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  ))}
                </div>
                <Button
                  onClick={() => setLoginMode('credentials')}
                  className="h-12 w-full bg-blue-600 text-[15px] font-semibold text-white hover:bg-blue-700 rounded-lg shadow-sm"
                >
                  Back to Username
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Footer Text */}
        <div className="pb-4 w-full text-center text-[11px] text-gray-500">
          © 2024 SML Legacy Limited. All rights reserved.
        </div>
      </div>
    </div>
  )
}
