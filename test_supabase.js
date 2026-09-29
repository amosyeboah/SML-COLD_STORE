const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const url = process.env.VITE_SUPABASE_URL || 'https://yhglbervaljjkmttzonk.supabase.co';
const key = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloZ2xiZXJ2YWxqamttdHR6b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwNDA4MzIsImV4cCI6MjEwNTYxNjgzMn0.8STKvBtPKL3J9BH7Mdvadrna-zcYYFqGXGaBx4y_Wis';

const client = createClient(url, key);

async function test() {
  const { data: sales, error: salesErr } = await client.from('cloud_sales').select('*').limit(5);
  console.log('Sales:', sales?.length, salesErr);

  const { data: prods, error: prodsErr } = await client.from('cloud_products').select('*').limit(5);
  console.log('Products:', prods?.length, prodsErr);
}

test();
