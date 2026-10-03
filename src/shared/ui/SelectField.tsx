import type { SelectHTMLAttributes } from "react";
import { Field } from "./Field";

export function SelectField({ label, error, hint, children, ...select }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; error?: string; hint?: string;
}) {
  return <Field label={label} {...(error === undefined ? {} : { error })} {...(hint === undefined ? {} : { hint })}>
    <select {...select}>{children}</select>
  </Field>;
}
