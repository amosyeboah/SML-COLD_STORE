const { PrismaClient } = require('../generated/client');
const path = require('path');
const dbPath = path.resolve(__dirname, '../database/pharmacy.db').replace(/\\/g, '/');
const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

async function main() {
  const byStatus = await prisma.syncOutbox.groupBy({
    by: ['status', 'entity'],
    _count: { id: true }
  });
  console.log('Outbox breakdown:\n', JSON.stringify(byStatus, null, 2));

  const total = await prisma.syncOutbox.count();
  console.log('Total Outbox records:', total);

  await prisma.syncOutbox.updateMany({
    where: { status: { in: ['FAILED', 'DEAD_LETTER'] } },
    data: { status: 'SYNCED', lastError: null, errorMessage: null }
  });

  const finalOutbox = await prisma.syncOutbox.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  console.log('\nFinal Outbox Status:');
  finalOutbox.forEach(g => console.log(`  - ${g.status}: ${g._count.id}`));
}

main().finally(() => prisma.$disconnect());
