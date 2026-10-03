# Desktop smoke test

Status: auth startup manually verified by the user after the fix. Role-based manual checks are deferred for the MVP because user management is not in scope yet; automated permission tests remain active. Other manual flows passed except edited purchase-draft confirmation, now covered by an automated regression test. Chromium portal/GLib diagnostics were reported without a user-visible failure.

For each role, sign in with a test account, verify that only permitted screens are visible, then exercise the listed flow. Confirm Arabic labels, loading/error feedback, and that refreshed balances and stock match the backend after each successful mutation.

## Owner

- [ ] Dashboard, reports, reminders, settings, and backup screens are available.
- [ ] Create/edit a customer and supplier; verify credit settings and opening balances.
- [ ] Create an item and recipe, add opening stock, then reconcile an inventory adjustment with PIN.
- [ ] Complete a purchase, packing order, cash/credit sale, collection, return, and write-off.
- [ ] Verify audit entries and that unauthorized credit override is rejected without a valid PIN.

## Sales

- [ ] Sales, customers, collections, and reminders are available; administration screens are hidden.
- [ ] Complete a cash sale and a credit sale within the customer's limit.
- [ ] Confirm insufficient stock / blocked customer / exceeded credit limit is rejected by the server and shown clearly.
- [ ] Record a collection, confirm a reminder, and verify balances refresh.

## Warehouse

- [ ] Inventory and packing are available; financial administration screens are hidden.
- [ ] Inspect lots and expiry dates, then complete a packing order using FIFO and manual lot selection.
- [ ] Confirm insufficient input stock is rejected and the snapshot remains unchanged.

## Purchasing

- [ ] Purchases and suppliers are available; owner-only administration remains hidden.
- [ ] Save and resume a purchase draft, confirm a purchase, record supplier payment, and return a purchase line.
- [ ] Verify stock lots and supplier balances refresh after each operation.
