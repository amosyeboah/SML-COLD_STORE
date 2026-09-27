import { prisma } from '../db/prisma'
import { DeviceInfo } from '../domain/types'
import { randomUUID } from 'crypto'

export async function registerDevice(info: DeviceInfo) {
  const storeId = info.storeId || 'sml_accra_main'
  return await prisma.device.upsert({
    where: { deviceId: info.deviceId },
    update: {
      deviceName: info.deviceName,
      deviceType: info.deviceType,
      appVersion: info.appVersion || '1.0.0',
      ipAddress: info.ipAddress || null,
      lastSeen: new Date(),
      status: 'ACTIVE',
    },
    create: {
      id: randomUUID(),
      deviceId: info.deviceId,
      storeId,
      deviceName: info.deviceName,
      deviceType: info.deviceType,
      appVersion: info.appVersion || '1.0.0',
      ipAddress: info.ipAddress || null,
      lastSeen: new Date(),
      status: 'ACTIVE',
    },
  })
}

export async function touchDeviceHeartbeat(deviceId: string, ipAddress?: string) {
  try {
    return await prisma.device.update({
      where: { deviceId },
      data: {
        lastSeen: new Date(),
        ...(ipAddress ? { ipAddress } : {}),
      },
    })
  } catch {
    return null
  }
}

export async function getDevices() {
  return await prisma.device.findMany({
    orderBy: { lastSeen: 'desc' },
  })
}

export async function getDevice(deviceId: string) {
  return await prisma.device.findUnique({
    where: { deviceId },
  })
}
