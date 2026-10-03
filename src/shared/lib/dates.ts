// Local device-calendar dates prevent UTC rollover from changing the business day.
export const localDateString = (date: Date) =>
  date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");

export const today = () => localDateString(new Date());

export const daysFromNow = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateString(date);
};

export const addDays = (isoDate: string, days: number) => {
  const date = new Date(isoDate + "T12:00:00");
  date.setDate(date.getDate() + days);
  return localDateString(date);
};
