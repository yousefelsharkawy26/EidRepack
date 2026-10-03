# Registered commands and queries

Generated from `electron/core/registry.cjs` by `npm run docs:commands`; do not edit by hand.

## Commands

| Command | Roles |
| --- | --- |
| `sale:confirm` | owner, sales |
| `sale:return` | owner, sales |
| `purchase:confirm` | owner, purchasing |
| `purchase:return` | owner, purchasing |
| `purchase-draft:save` | owner, purchasing |
| `purchase-draft:delete` | owner, purchasing |
| `packing:confirm` | owner, warehouse |
| `packing:cancel` | owner |
| `inventory:adjust` | owner, warehouse |
| `inventory:opening` | owner |
| `item:save` | owner, warehouse, purchasing |
| `recipe:save` | owner, warehouse |
| `customer:save` | owner, sales |
| `supplier:pay` | owner, purchasing |
| `supplier:save` | owner, purchasing |
| `customer:collect` | owner, sales |
| `customer:promise` | owner, sales |
| `payment:reverse` | owner |
| `customer:writeoff` | owner |
| `reminder:update` | owner, sales |
| `reminder-rule:save` | owner |
| `reminder-template:save` | owner |
| `settings:save` | owner |
| `user:save` | owner |

## Queries

| Query | Roles |
| --- | --- |
| `invoices:list` | owner, sales, purchasing |
| `inventory:movements` | owner, warehouse, purchasing |
| `messages:list` | owner, sales |
| `audit:list` | owner |
| `reports:period` | owner |
| `query:snapshot` | owner, sales, warehouse, purchasing |
