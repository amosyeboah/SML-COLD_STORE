const Database = require('better-sqlite3');
const db = new Database('database/pharmacy.db', { readonly: true });
const rows = db.prepare("SELECT id, event_type, table_name, payload, status, error, created_at FROM syncInbox ORDER BY created_at DESC LIMIT 20").all();
console.log(JSON.stringify(rows, null, 2));
