import type { PrismaClient as PrismaClientType } from '../../../generated/client'
import * as path from 'path'
import * as fs from 'fs'

export type PrismaClient = PrismaClientType

let prismaInstance: PrismaClientType | null = null

function loadPrismaClass(): new (...args: any[]) => PrismaClientType {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../../generated/client')
    return mod.PrismaClient || mod.default?.PrismaClient || mod
  } catch {}

  try {
    const cwdPath = path.resolve(process.cwd(), 'generated/client')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(cwdPath)
    return mod.PrismaClient || mod.default?.PrismaClient || mod
  } catch {}

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@prisma/client')
    return mod.PrismaClient || mod
  } catch (err) {
    throw new Error('Failed to resolve PrismaClient: ' + String(err))
  }
}

export function resolveDatabasePath(): string {
  // 1. Explicit environment variable
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('file:')) {
    const raw = process.env.DATABASE_URL.replace(/^file:/, '')
    return path.resolve(raw)
  }

  // 2. Electron runtime userData check if available
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron')
    const app = electron.app || electron.remote?.app
    if (app && typeof app.getPath === 'function') {
      const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
      if (!isDev) {
        const prodDir = path.join(app.getPath('userData'), 'database')
        if (!fs.existsSync(prodDir)) {
          fs.mkdirSync(prodDir, { recursive: true })
        }
        return path.join(prodDir, 'pharmacy.db')
      }
    }
  } catch {
    // Not running inside Electron or Electron not initialized yet
  }

  // 3. Project workspace default (dev / CLI / server)
  const defaultDir = path.resolve(__dirname, '../../../../database')
  if (fs.existsSync(defaultDir)) {
    return path.join(defaultDir, 'pharmacy.db')
  }

  const cwdDir = path.resolve(process.cwd(), 'database')
  if (!fs.existsSync(cwdDir)) {
    fs.mkdirSync(cwdDir, { recursive: true })
  }
  return path.join(cwdDir, 'pharmacy.db')
}

export function resolveDatabaseUrl(): string {
  const dbPath = resolveDatabasePath()
  const normalized = dbPath.replace(/\\/g, '/')
  return `file:${normalized}`
}

export function getPrismaClient(): PrismaClientType {
  if (!prismaInstance) {
    const dbUrl = resolveDatabaseUrl()
    process.env.DATABASE_URL = dbUrl
    const ClientClass = loadPrismaClass()
    prismaInstance = new ClientClass({
      datasources: {
        db: {
          url: dbUrl,
        },
      },
    })
  }
  return prismaInstance
}

export const prisma = getPrismaClient()
