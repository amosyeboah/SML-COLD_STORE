-- ==============================================================================
-- SML LEGACY LIMITED - COLD STORE REMOTE SUPABASE POSTGRESQL SCHEMA
-- Facilitates UK Owner (Sofiyat Opeyemi Yusuf) Remote Access & Offline-Sync Engine
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. STORES / DEPOTS TABLE
CREATE TABLE IF NOT EXISTS sml_stores (
    id TEXT PRIMARY KEY DEFAULT 'sml_accra_main',
    name TEXT NOT NULL DEFAULT 'SML Legacy Limited - Cold Store Main Depot',
    location TEXT NOT NULL DEFAULT 'Cold Store Market Depot, Accra, Ghana',
    phone TEXT NOT NULL DEFAULT '+233 54 386 4610',
    email TEXT NOT NULL DEFAULT 'sorphygold@yahoo.com',
    owner_name TEXT NOT NULL DEFAULT 'Sofiyat Opeyemi Yusuf',
    owner_phone TEXT NOT NULL DEFAULT '+447999007775',
    currency TEXT NOT NULL DEFAULT 'GHS',
    currency_symbol TEXT NOT NULL DEFAULT 'GH₵',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default store record if not exists
INSERT INTO sml_stores (id, name, location, phone, email, owner_name, owner_phone, currency, currency_symbol)
VALUES (
    'sml_accra_main',
    'SML Legacy Limited - Cold Store Main Depot',
    'Cold Store Market Depot, Accra, Ghana',
    '+233 54 386 4610',
    'sorphygold@yahoo.com',
    'Sofiyat Opeyemi Yusuf',
    '+447999007775',
    'GHS',
    'GH₵'
)
ON CONFLICT (id) DO NOTHING;

-- 2. CLOUD PRODUCTS CATALOG
CREATE TABLE IF NOT EXISTS cloud_products (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL DEFAULT 'sml_accra_main' REFERENCES sml_stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    generic_name TEXT,
    sku TEXT NOT NULL,
    category_name TEXT NOT NULL DEFAULT 'General',
    price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    stock_quantity INT NOT NULL DEFAULT 0,
    min_stock_level INT NOT NULL DEFAULT 10,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_products_sku ON cloud_products(sku);
CREATE INDEX IF NOT EXISTS idx_cloud_products_category ON cloud_products(category_name);

-- 3. CLOUD BATCHES (Freezer lots & expiry)
CREATE TABLE IF NOT EXISTS cloud_batches (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES cloud_products(id) ON DELETE CASCADE,
    batch_number TEXT NOT NULL,
    expiry_date TIMESTAMPTZ NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_batches_expiry ON cloud_batches(expiry_date);

-- 4. CLOUD SALES (Mirrored POS Transactions)
CREATE TABLE IF NOT EXISTS cloud_sales (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL DEFAULT 'sml_accra_main' REFERENCES sml_stores(id) ON DELETE CASCADE,
    sale_number TEXT,
    customer_name TEXT DEFAULT 'Walk-in Customer',
    total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    cashier_username TEXT DEFAULT 'cashier',
    date TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_sales_date ON cloud_sales(date DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_sales_total ON cloud_sales(total DESC);

-- 5. CLOUD SALE ITEMS
CREATE TABLE IF NOT EXISTS cloud_sale_items (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    sale_id TEXT NOT NULL REFERENCES cloud_sales(id) ON DELETE CASCADE,
    product_id TEXT,
    product_name TEXT NOT NULL,
    sku TEXT,
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00
);

CREATE INDEX IF NOT EXISTS idx_cloud_sale_items_sale ON cloud_sale_items(sale_id);

-- 6. CLOUD AUDIT LOGS (High-importance loss prevention & governance)
CREATE TABLE IF NOT EXISTS cloud_audit_logs (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL DEFAULT 'sml_accra_main' REFERENCES sml_stores(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    category TEXT NOT NULL,
    details TEXT NOT NULL,
    operator TEXT DEFAULT 'System',
    role TEXT DEFAULT 'STAFF',
    severity TEXT NOT NULL DEFAULT 'INFO',
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_audit_logs_created_at ON cloud_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_audit_logs_severity ON cloud_audit_logs(severity);

-- 7. CLOUD SYNC SESSIONS (Device sync telemetry)
CREATE TABLE IF NOT EXISTS cloud_sync_sessions (
    id TEXT PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    store_id TEXT NOT NULL DEFAULT 'sml_accra_main' REFERENCES sml_stores(id) ON DELETE CASCADE,
    device_id TEXT DEFAULT 'Main POS Desktop Terminal',
    sync_type TEXT DEFAULT 'AUTO_BACKGROUND',
    status TEXT NOT NULL DEFAULT 'SUCCESS',
    items_count INT NOT NULL DEFAULT 0,
    duration_ms INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_sessions_created_at ON cloud_sync_sessions(created_at DESC);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) & ACCESS POLICIES
-- ==============================================================================
ALTER TABLE sml_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_sync_sessions ENABLE ROW LEVEL SECURITY;

-- Allow read and write for authenticated users & anon (POS client with API key)
CREATE POLICY "Allow public read for portal" ON sml_stores FOR SELECT USING (true);
CREATE POLICY "Allow POS and Portal access products" ON cloud_products FOR ALL USING (true);
CREATE POLICY "Allow POS and Portal access batches" ON cloud_batches FOR ALL USING (true);
CREATE POLICY "Allow POS and Portal access sales" ON cloud_sales FOR ALL USING (true);
CREATE POLICY "Allow POS and Portal access sale items" ON cloud_sale_items FOR ALL USING (true);
CREATE POLICY "Allow POS and Portal access audit logs" ON cloud_audit_logs FOR ALL USING (true);
CREATE POLICY "Allow POS and Portal access sync sessions" ON cloud_sync_sessions FOR ALL USING (true);

-- ==============================================================================
-- REALTIME PUBLICATION (Enables instantaneous owner updates in the UK)
-- ==============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE cloud_sales;
ALTER PUBLICATION supabase_realtime ADD TABLE cloud_products;
ALTER PUBLICATION supabase_realtime ADD TABLE cloud_audit_logs;
