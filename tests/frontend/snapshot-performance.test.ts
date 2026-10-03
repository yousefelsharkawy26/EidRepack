import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mapSnapshot } from "../../src/lib/api";
import type { Snapshot } from "../../src/shared/api/snapshot-types";

const require = createRequire(import.meta.url);
const { applyMigrations, configureDatabase } = require("../../electron/migrations/runner.cjs");
const { buildSnapshot } = require("../../electron/services/queries.cjs");

describe("seeded snapshot performance", () => {
  it("loads and maps a snapshot with 5,000 sales", () => {
    const db = new Database(":memory:");
    try {
      configureDatabase(db);
      applyMigrations(db);
      const now = "2026-10-03T00:00:00.000Z";
      db.prepare("INSERT INTO users (id,username,display_name,role,password_hash,is_active,created_at,updated_at) VALUES ('user-owner','owner','المالك','owner','x',1,?,?)").run(now, now);
      db.prepare("INSERT INTO customers (id,name,credit_limit_minor,credit_days,is_active,created_at,updated_at) VALUES ('customer-1','عميل',100000,15,1,?,?)").run(now, now);
      db.prepare("INSERT INTO items (id,sku,name,type,base_unit_id,min_stock_base,default_sale_price_minor,is_active,created_at,updated_at) VALUES ('item-1','SKU-1','صنف','raw','unit-piece',0,100,1,?,?)").run(now, now);

      const insertOrder = db.prepare("INSERT INTO sales_orders (id,number,customer_id,date,status,subtotal_minor,gross_total_minor,total_minor,paid_amount_minor,credit_amount_minor,created_at,created_by) VALUES (?,?,?,'2026-10-03','confirmed',100,100,100,0,100,?, 'user-owner')");
      const insertLine = db.prepare("INSERT INTO sales_lines (id,order_id,item_id,qty_base,unit_price_minor,line_total_minor,unit_cost_minor,cogs_total_minor) VALUES (?,?, 'item-1',1,100,100,25,25)");
      const seedSales = db.transaction(() => {
        for (let index = 1; index <= 5000; index += 1) {
          const id = `sale-${index}`;
          insertOrder.run(id, `INV-2026-${String(index).padStart(4, "0")}`, "customer-1", now);
          insertLine.run(`line-${index}`, id);
        }
      });
      seedSales();

      const startedAt = performance.now();
      const snapshot = buildSnapshot(db, { userId: "user-owner", role: "owner" }) as Snapshot;
      const state = mapSnapshot(snapshot);
      const elapsedMs = performance.now() - startedAt;

      expect(state.sales).toHaveLength(5000);
      expect(elapsedMs).toBeGreaterThan(0);
      console.info(`5,000-sale snapshot query + mapping: ${elapsedMs.toFixed(1)} ms`);
    } finally {
      db.close();
    }
  });
});
