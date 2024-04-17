import { MembershipStatus, PaymentMethod } from "@beabee/beabee-common";

import { createQueryBuilder, getRepository } from "@core/database";
import { log as mainLogger } from "@core/logging";
import { PaymentForm } from "@core/utils";
import { calcRenewalDate } from "@core/utils/payment";

import Contact from "@models/Contact";
import Payment from "@models/Payment";
import ContactContribution from "@models/ContactContribution";

import {
  PaymentProvider,
  UpdateContributionResult
} from "@core/providers/payment";
import GCProvider from "@core/providers/payment/GCProvider";
import ManualProvider from "@core/providers/payment/ManualProvider";
import StripeProvider from "@core/providers/payment/StripeProvider";
import { CompletedPaymentFlow } from "@core/providers/payment-flow";

import { ContributionInfo } from "@type/contribution-info";

const log = mainLogger.child({ app: "payment-service" });

const PaymentProviders = {
  [PaymentMethod.StripeCard]: StripeProvider,
  [PaymentMethod.StripeSEPA]: StripeProvider,
  [PaymentMethod.StripeBACS]: StripeProvider,
  [PaymentMethod.StripePayPal]: StripeProvider,
  [PaymentMethod.GoCardlessDirectDebit]: GCProvider
};

export function getMembershipStatus(contact: Contact): MembershipStatus {
  return contact.membership
    ? contact.membership.isActive
      ? contact.contribution.cancelledAt
        ? MembershipStatus.Expiring
        : MembershipStatus.Active
      : MembershipStatus.Expired
    : MembershipStatus.None;
}

type ProviderFn<T> = (
  p: PaymentProvider,
  data: ContactContribution
) => Promise<T>;

class PaymentService {
  async getData(contact: Contact): Promise<ContactContribution> {
    const data = await getRepository(ContactContribution).findOneByOrFail({
      contactId: contact.id
    });
    log.info("Loaded data for contact " + contact.id, { data });
    // Load full contact into data
    return { ...data, contact: contact };
  }

  async getDataBy(
    key: string,
    value: string
  ): Promise<ContactContribution | undefined> {
    const data = await createQueryBuilder(ContactContribution, "cc")
      .innerJoinAndSelect("cc.contact", "m")
      .leftJoinAndSelect("m.roles", "mp")
      .where(`data->>:key = :value`, { key, value })
      .getOne();

    // TODO: check undefined
    return data || undefined;
  }

  async updateDataBy(contact: Contact, key: string, value: unknown) {
    await createQueryBuilder()
      .update(ContactContribution)
      .set({ data: () => "jsonb_set(data, :key, :value)" })
      .where("contact = :id")
      .setParameters({
        key: `{${key}}`,
        value: JSON.stringify(value),
        id: contact.id
      })
      .execute();
  }

  private async provider(contact: Contact, fn: ProviderFn<void>): Promise<void>;
  private async provider<T>(contact: Contact, fn: ProviderFn<T>): Promise<T>;
  private async provider<T>(contact: Contact, fn: ProviderFn<T>): Promise<T> {
    return this.providerFromData(await this.getData(contact), fn);
  }

  private async providerFromData<T>(
    data: ContactContribution,
    fn: ProviderFn<T>
  ): Promise<T> {
    const Provider = data.method
      ? PaymentProviders[data.method]
      : ManualProvider;
    return await fn(new Provider(data), data);
  }

  async canChangeContribution(
    contact: Contact,
    useExistingPaymentSource: boolean,
    paymentForm: PaymentForm
  ): Promise<boolean> {
    const ret = await this.provider(contact, (p) =>
      p.canChangeContribution(useExistingPaymentSource, paymentForm)
    );
    log.info(
      `Contact ${contact.id} ${ret ? "can" : "cannot"} change contribution`
    );
    return ret;
  }

  async getContributionInfo(contact: Contact): Promise<ContributionInfo> {
    return await this.provider<ContributionInfo>(contact, async (p, d) => {
      // Store payment data in contact for getMembershipStatus
      // TODO: fix this!
      contact.contribution = d;

      const renewalDate = !d.cancelledAt && calcRenewalDate(contact);

      return {
        type: contact.contributionType,
        ...(contact.contributionAmount !== null && {
          amount: contact.contributionAmount
        }),
        ...(contact.contributionPeriod !== null && {
          period: contact.contributionPeriod
        }),
        ...(contact.membership?.dateExpires && {
          membershipExpiryDate: contact.membership.dateExpires
        }),
        membershipStatus: getMembershipStatus(contact),
        ...(await p.getContributionInfo()),
        ...(d.cancelledAt && { cancellationDate: d.cancelledAt }),
        ...(renewalDate && { renewalDate })
      };
    });
  }

  async getPayments(contact: Contact): Promise<Payment[]> {
    return await getRepository(Payment).findBy({ contactId: contact.id });
  }

  async createContact(contact: Contact): Promise<void> {
    log.info("Create contact for contact " + contact.id);
    await getRepository(ContactContribution).save({ contact });
  }

  async updateContact(
    contact: Contact,
    updates: Partial<Contact>
  ): Promise<void> {
    log.info("Update contact for contact " + contact.id);
    await this.provider(contact, (p) => p.updateContact(updates));
  }

  async updateContribution(
    contact: Contact,
    paymentForm: PaymentForm
  ): Promise<UpdateContributionResult> {
    log.info("Update contribution for contact " + contact.id);
    const ret = await this.provider(contact, (p) =>
      p.updateContribution(paymentForm)
    );
    await getRepository(ContactContribution).update(
      { contactId: contact.id },
      { cancelledAt: null }
    );
    return ret;
  }

  async updatePaymentMethod(
    contact: Contact,
    completedPaymentFlow: CompletedPaymentFlow
  ): Promise<void> {
    log.info("Update payment method for contact " + contact.id, {
      completedPaymentFlow
    });

    const contribution = await this.getData(contact);
    const newMethod = completedPaymentFlow.joinForm.paymentMethod;
    if (contribution.method !== newMethod) {
      log.info("Changing payment method, cancelling previous contribution", {
        contribution,
        newMethod
      });
      await this.providerFromData(contribution, (p) =>
        p.cancelContribution(false)
      );

      // TODO: clear contribution properly
      contribution.method = newMethod;
      contribution.cancelledAt = new Date();
      contribution.customerId = null;
      contribution.mandateId = null;
      contribution.subscriptionId = null;
      await getRepository(ContactContribution).save(contribution);
    }

    await this.providerFromData(contribution, (p) =>
      p.updatePaymentMethod(completedPaymentFlow)
    );
  }

  async cancelContribution(
    contact: Contact,
    keepMandate = false
  ): Promise<void> {
    log.info("Cancel contribution for contact " + contact.id);
    await this.provider(contact, (p) => p.cancelContribution(keepMandate));
    await getRepository(ContactContribution).update(
      { contactId: contact.id },
      { cancelledAt: new Date() }
    );
  }

  async permanentlyDeleteContact(contact: Contact): Promise<void> {
    await this.provider(contact, (p) => p.permanentlyDeleteContact());
    await getRepository(ContactContribution).delete({ contactId: contact.id });
    await getRepository(Payment).delete({ contactId: contact.id });
  }
}

export default new PaymentService();
