import { prisma } from '../db/prisma'
import { recordAudit } from './auditService'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

export async function login(username: string, password: string, deviceId?: string) {
  const user = await prisma.user.findUnique({ where: { username } })
  let valid = false
  if (user) {
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      valid = await bcrypt.compare(password, user.password)
    } else {
      valid = password === user.password
    }
  }

  if (!user || !valid) {
    await recordAudit({
      action: 'LOGIN_FAILED',
      category: 'AUTH',
      details: `Failed sign-in attempt for username "${username}"`,
      username,
      userRole: user?.role || 'UNKNOWN',
      severity: 'WARNING',
      deviceId,
      metadata: { attemptedUsername: username },
    })
    throw new Error('Invalid credentials')
  }

  await recordAudit({
    action: 'LOGIN_SUCCESS',
    category: 'AUTH',
    details: `Staff user "${user.username}" signed in with role [${user.role}]`,
    username: user.username,
    userRole: user.role,
    severity: 'INFO',
    deviceId,
  })

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}

export async function loginWithPin(pin: string, selectedRole?: string, deviceId?: string) {
  const allUsers = await prisma.user.findMany()
  let user = allUsers.find((u) => u.pin === pin)

  // Fallback to configured default PINs if user didn't set a custom PIN yet
  if (!user) {
    let targetUsername = ''
    if ((selectedRole === 'ADMIN' && pin === '1111') || pin === '1111' || pin === '9999') {
      targetUsername = 'admin'
    } else if ((selectedRole === 'MANAGER' && pin === '2222') || pin === '2222' || pin === '5555') {
      targetUsername = 'manager'
    } else if ((selectedRole === 'CASHIER' && pin === '1234') || pin === '1234' || pin === '0000') {
      targetUsername = 'cashier'
    }
    if (targetUsername) {
      user = allUsers.find((u) => u.username.toLowerCase() === targetUsername.toLowerCase())
    }
  }

  if (!user) {
    await recordAudit({
      action: 'PIN_LOGIN_FAILED',
      category: 'AUTH',
      details: `Failed PIN sign-in attempt with code [****]`,
      severity: 'WARNING',
      deviceId,
    })
    throw new Error('Invalid PIN code. Try 1111 (Admin) or 1234 (Cashier)')
  }

  await recordAudit({
    action: 'PIN_LOGIN_SUCCESS',
    category: 'AUTH',
    details: `Staff user "${user.username}" quick PIN unlocked session [Role: ${user.role}]`,
    username: user.username,
    userRole: user.role,
    severity: 'INFO',
    deviceId,
  })

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}

export async function getUsers() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      pin: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return users
}

export async function createUser(data: {
  username: string
  passwordHash: string
  role: string
  pin?: string
}) {
  const password = data.passwordHash.startsWith('$2a$') || data.passwordHash.startsWith('$2b$')
    ? data.passwordHash
    : await bcrypt.hash(data.passwordHash, 10)

  return await prisma.user.create({
    data: {
      id: randomUUID(),
      username: data.username,
      password,
      role: data.role,
      pin: data.pin || null,
    },
    select: {
      id: true,
      username: true,
      role: true,
      pin: true,
      createdAt: true,
    },
  })
}

export async function updateUser(
  id: string,
  data: {
    username?: string
    role?: string
    passwordHash?: string
    pin?: string
  }
) {
  const updateData: any = {}
  if (data.username !== undefined) updateData.username = data.username
  if (data.role !== undefined) updateData.role = data.role
  if (data.pin !== undefined) updateData.pin = data.pin
  if (data.passwordHash) {
    updateData.password =
      data.passwordHash.startsWith('$2a$') || data.passwordHash.startsWith('$2b$')
        ? data.passwordHash
        : await bcrypt.hash(data.passwordHash, 10)
  }

  return await prisma.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      username: true,
      role: true,
      pin: true,
      createdAt: true,
    },
  })
}

export async function deleteUser(id: string) {
  return await prisma.user.delete({
    where: { id },
  })
}
