import { useState } from "react";
import { Customer, money } from "../../lib/domain";
import { toMinor } from "../../lib/api";
import { useApp } from "../../app/AppProvider";
import { FileBarChart, Plus } from "lucide-react";
import { printCustomerStatement } from "../print";
import { exportCustomerStatement } from "../statements";
import CustomerForm from "./CustomerForm";

function Customers() {
  const { state, currentUser } = useApp();
  if (!state || !currentUser) return null;
  return <CustomersContent />;
}

function CustomersContent() {
  const { state: snapshot, run, busy, currentUser: session, notify } = useApp();
  const state = snapshot!;
  const currentUser = session!;
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [creditLimit, setCreditLimit] = useState(0);
  const [creditDays, setCreditDays] = useState(
    state.settings.defaultCreditDays,
  );
  const [notes, setNotes] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const isOwner = currentUser.role === "owner";
  const normalizeWhatsapp = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    return digits.startsWith("0") ? "2" + digits : digits;
  };
  const openForm = (customer?: Customer) => {
    setEditingCustomer(customer || null);
    setName(customer?.name || "");
    setPhone(customer?.phone || "");
    setWhatsapp(customer?.whatsapp || "");
    setCreditLimit(customer?.creditLimit ?? 0);
    setCreditDays(customer?.creditDays ?? state.settings.defaultCreditDays);
    setNotes(customer?.notes || "");
    setOpeningBalance(0);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingCustomer(null);
  };
  // UX hint — backend is authoritative.
  const save = () => {
    if (!name.trim()) return notify("أدخل اسم العميل أولًا.");
    if (isOwner && (!Number.isFinite(creditLimit) || creditLimit < 0))
      return notify("حد الائتمان يجب أن يكون صفرًا أو أكثر.");
    if (isOwner && (!Number.isFinite(creditDays) || creditDays < 0))
      return notify("فترة السداد يجب أن تكون صفرًا أو أكثر.");
    if (
      !editingCustomer &&
      isOwner &&
      (!Number.isFinite(openingBalance) || openingBalance < 0)
    )
      return notify("الرصيد الافتتاحي يجب أن يكون صفرًا أو أكثر.");
    // Non-owners must not send credit fields at all — the backend rejects
    // their presence without owner rights or a PIN elevation.
    const payload: Record<string, unknown> = {
      id: editingCustomer?.id,
      name: name.trim(),
      phone: phone.trim(),
      whatsapp: normalizeWhatsapp(whatsapp),
      notes: notes.trim(),
    };
    if (isOwner) {
      payload.creditLimitMinor = toMinor(creditLimit);
      payload.creditDays = Math.round(creditDays);
      if (!editingCustomer && openingBalance > 0)
        payload.openingBalanceMinor = toMinor(openingBalance);
    }
    void run(
      "customer:save", payload,
      editingCustomer ? "تم حفظ تعديلات العميل." : "تمت إضافة العميل بنجاح.",
    ).then((ok) => {
      if (ok) closeForm();
    });
  };
  // Blocking is the only way BR-CR-07 can actually be exercised, and it is
  // reversible — the audit log records both directions.
  const toggleBlocked = (customer: Customer) => {
    if (
      !customer.blocked &&
      !window.confirm(
        'حظر "' +
          customer.name +
          '" سيمنع أي بيع آجل جديد له، ولا يمكن تجاوزه بـ PIN المالك. متابعة؟',
      )
    )
      return;
    void run(
      "customer:save",
      {
          id: customer.id,
          name: customer.name,
          isBlocked: !customer.blocked,
          blockReason: !customer.blocked ? "حظر يدوي من شاشة العملاء" : null,
      },
      customer.blocked
        ? "تم فك الحظر عن العميل."
        : "تم حظر العميل من البيع الآجل.",
    );
  };
  return (
    <>
      <div className="section-header">
        <div>
          <h2>العملاء والائتمان</h2>
          <p>تابع الرصيد والحد الائتماني والاستحقاقات</p>
        </div>
        <button className="primary" onClick={() => openForm()}>
          <Plus size={15} /> إضافة عميل
        </button>
      </div>
      <section className="card card-flush">
        <table>
          <thead>
            <tr>
              <th>العميل</th>
              <th>الهاتف / واتساب</th>
              <th>حد الائتمان</th>
              <th>الرصيد المستخدم</th>
              <th>المتاح</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {state.customers.map((customer) => {
              const ratio = customer.creditLimit
                ? customer.balance / customer.creditLimit
                : 0;
              return (
                <tr key={customer.id}>
                  <td className="name-cell">
                    <b>{customer.name}</b>
                    <small>
                      {customer.notes ||
                        "فترة السداد: " + customer.creditDays + " يوم"}
                    </small>
                  </td>
                  <td>{customer.phone || "—"}</td>
                  <td>{money(customer.creditLimit)}</td>
                  <td>{money(customer.balance)}</td>
                  <td className={"text-emphasis " + (ratio > 0.8 ? "negative-text" : "positive-value")}>
                    {money(
                      Math.max(customer.creditLimit - customer.balance, 0),
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        "status " +
                        (customer.blocked
                          ? "red"
                          : ratio >= 0.8
                            ? "yellow"
                            : "green")
                      }
                    >
                      {customer.blocked
                        ? "محظور"
                        : ratio >= 0.8
                          ? "قريب من الحد"
                          : "منتظم"}
                    </span>
                  </td>
                  <td className="table-actions-cell">
                    <button
                      className="secondary"
                      onClick={() => openForm(customer)}
                    >
                      تعديل
                    </button>
                    {isOwner && (
                      <button
                        className="secondary"
                        onClick={() => toggleBlocked(customer)}
                        disabled={busy}
                      >
                        {customer.blocked ? "فك الحظر" : "حظر"}
                      </button>
                    )}
                    <button
                      className="secondary"
                      onClick={() => {
                        void printCustomerStatement(state, customer.id).then(
                          (ok) => {
                            if (!ok)
                              notify(
                                "تعذرت الطباعة؛ تحقق من إعدادات الطابعة أو السماح بالنوافذ المنبثقة.",
                              );
                          },
                        );
                      }}
                    >
                      <FileBarChart size={14} /> طباعة
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        exportCustomerStatement(state, customer.id)
                      }
                    >
                      CSV
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <CustomerForm
        open={formOpen}
        editing={editingCustomer}
        isOwner={isOwner}
        busy={busy}
        onClose={closeForm}
        onSave={save}
        name={name} setName={setName}
        phone={phone} setPhone={setPhone}
        whatsapp={whatsapp} setWhatsapp={setWhatsapp}
        creditLimit={creditLimit} setCreditLimit={setCreditLimit}
        creditDays={creditDays} setCreditDays={setCreditDays}
        openingBalance={openingBalance} setOpeningBalance={setOpeningBalance}
        notes={notes} setNotes={setNotes}
      />
    </>
  );
}

export default Customers;
