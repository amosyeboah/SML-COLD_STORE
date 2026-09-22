import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function test() {
  const user = await prisma.user.findUnique({ where: { username: 'admin' } })
  console.log(user)
  if (user) {
    const valid = await bcrypt.compare('admin123', user.passwordHash)
    console.log('Password valid:', valid)
  }
}
test().finally(() => prisma.$disconnect())
