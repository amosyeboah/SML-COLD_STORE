const { PrismaClient } = require('../generated/client');
const path = require('path');
const dbPath = path.resolve(__dirname, '../database/pharmacy.db').replace(/\\/g, '/');
const prisma = new PrismaClient({
  datasources: { db: { url: `file:${dbPath}` } }
});

async function main() {
  try {
    const users = await prisma.user.count();
    const categories = await prisma.category.count();
    const medicines = await prisma.medicine.count();
    const batches = await prisma.batch.count();
    const sales = await prisma.sale.count();
    const saleItems = await prisma.saleItem.count();
    const purchases = await prisma.purchase.count();
    const customers = await prisma.customer.count();
    const suppliers = await prisma.supplier.count();
    const settings = await prisma.setting.count();
    const auditLogs = await prisma.auditLog.count();

    console.log(JSON.stringify({
      users,
      categories,
      medicines,
      batches,
      sales,
      saleItems,
      purchases,
      customers,
      suppliers,
      settings,
      auditLogs
    }, null, 2));
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
