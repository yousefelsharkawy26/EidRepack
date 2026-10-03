export const toMinor = (egp: number) => {
  if (!Number.isFinite(egp)) throw new Error("مبلغ غير صالح");
  return Math.round(egp * 100);
};

export const toEgp = (minor: number) => minor / 100;

export const money = (amount: number) =>
  new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(amount);
