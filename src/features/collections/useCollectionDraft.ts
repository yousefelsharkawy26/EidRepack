import { useState } from "react";
import type { CustomerPayment, Sale } from "../../lib/domain";
import { daysFromNow, today } from "../../lib/domain";

export function useCollectionDraft() {
  const [selected, setSelected] = useState<Sale | null>(null);
  const [amount, setAmount] = useState(0);
  const [promiseDate, setPromiseDate] = useState(daysFromNow(3));
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentCustomerId, setPaymentCustomerId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "wallet">("cash");
  const [paymentDate, setPaymentDate] = useState(today());
  const [returning, setReturning] = useState<Sale | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnLineIndex, setReturnLineIndex] = useState(0);
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState("بضاعة مرتجعة صالحة");
  const [writeOffSale, setWriteOffSale] = useState<Sale | null>(null);
  const [writeOffReason, setWriteOffReason] = useState("");
  const [reversingPayment, setReversingPayment] = useState<CustomerPayment | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  return {
    selected, setSelected, amount, setAmount, promiseDate, setPromiseDate,
    paymentModalOpen, setPaymentModalOpen, paymentCustomerId, setPaymentCustomerId,
    paymentMethod, setPaymentMethod, paymentDate, setPaymentDate,
    returning, setReturning, returnModalOpen, setReturnModalOpen,
    returnLineIndex, setReturnLineIndex, returnQty, setReturnQty,
    returnReason, setReturnReason, writeOffSale, setWriteOffSale,
    writeOffReason, setWriteOffReason, reversingPayment, setReversingPayment,
    reversalReason, setReversalReason,
  };
}
