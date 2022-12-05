import { PaymentMethod } from "@beabee/beabee-common";
import { Column, Entity, JoinColumn, OneToOne } from "typeorm";

import type Contact from "./Contact";

export interface GCPaymentData {
  customerId: string | null;
  mandateId: string | null;
  subscriptionId: string | null;
  cancelledAt: Date | null;
  payFee: boolean | null;
  nextMonthlyAmount: number | null;
}

export interface ManualPaymentData {
  source: string;
  reference: string;
}

export interface StripePaymentData {
  customerId: string | null;
  mandateId: string | null;
  subscriptionId: string | null;
  cancelledAt: Date | null;
  payFee: boolean | null;
  nextAmount: {
    chargeable: number;
    monthly: number;
  } | null;
}

export type PaymentProviderData =
  | GCPaymentData
  | ManualPaymentData
  | StripePaymentData
  | {};

@Entity()
export default class PaymentData {
  @OneToOne("Contact", "profile", { primary: true })
  @JoinColumn()
  contact!: Contact;

  @Column({ type: String, nullable: true })
  method!: PaymentMethod | null;

  @Column({ type: "jsonb", default: "{}" })
  data!: PaymentProviderData;
}
