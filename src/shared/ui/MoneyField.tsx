import type { InputHTMLAttributes } from "react";
import { NumberField } from "./NumberField";

export function MoneyField(props: InputHTMLAttributes<HTMLInputElement> & {
  label: string; error?: string; hint?: string;
}) {
  return <NumberField {...props} step={props.step ?? "0.01"} inputMode="decimal" />;
}
