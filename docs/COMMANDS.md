# Registered commands and queries

Generated from `electron/core/registry.cjs` by `npm run docs:commands`; do not edit by hand.

## Commands

| Command | Roles |
| --- | --- |
| `purchase:confirm` | owner, purchasing |
| `purchase:return` | owner, purchasing |
| `purchase-draft:save` | owner, purchasing |
| `purchase-draft:delete` | owner, purchasing |
| `supplier:pay` | owner, purchasing |
| `supplier:save` | owner, purchasing |
| `packing:confirm` | owner, warehouse |
| `packing:cancel` | owner |
| `sale:confirm` | owner, sales |
| `sale:return` | owner, sales |
| `customer:collect` | owner, sales |
| `customer:promise` | owner, sales |
| `customer:save` | owner, sales |
| `customer:writeoff` | owner |
| `payment:reverse` | owner |
| `reminder:update` | owner, sales |
| `reminder-rule:save` | owner |
| `reminder-template:save` | owner |
| `inventory:adjust` | owner, warehouse |
| `inventory:opening` | owner |
| `item:save` | owner, warehouse, purchasing |
| `recipe:save` | owner, warehouse |
| `user:save` | owner |
| `settings:save` | owner |

## Queries

| Query | Roles |
| --- | --- |
| `query:snapshot` | owner, sales, warehouse, purchasing |
| `inventory:movements` | owner, warehouse, purchasing |
| `audit:list` | owner |
| `messages:list` | owner, sales |
| `invoices:list` | owner, sales, purchasing |
