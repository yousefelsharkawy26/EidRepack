import type { InputHTMLAttributes } from "react";
import { Field } from "./Field";

export function NumberField({ label, error, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; error?: string; hint?: string;
}) {
  return <Field label={label} {...(error === undefined ? {} : { error })} {...(hint === undefined ? {} : { hint })}>
    <input {...input} type="number" onChange={input.onChange} />
  </Field>;
}
