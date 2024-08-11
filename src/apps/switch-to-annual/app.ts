import express from "express";

import config from "@config";

import { isLoggedIn } from "@core/middleware";
import { wrapAsync } from "@core/utils";

import ContactsService from "@core/services/ContactsService";

import Contact from "@models/Contact";
import PaymentService from "@core/services/PaymentService";
import { ContributionPeriod, PaymentMethod } from "@beabee/beabee-common";
import { getRepository } from "@core/database";
import ContactActivity, { ActivityType } from "@models/ContactActivity";
import gocardless from "@core/lib/gocardless";
import { PaymentCurrency, SubscriptionIntervalUnit } from "gocardless-nodejs";
import ContactContribution from "@models/ContactContribution";
import { stripe } from "@core/lib/stripe";
import { add } from "date-fns";

// import { createGiftSchema, updateGiftAddressSchema } from "./schema.json";

const app = express();

app.set("views", __dirname + "/views");

app.get("/", isLoggedIn, (req, res) => {
  res.render("index", { user: req.user });
});

app.post(
  "/",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const contact = req.user as Contact;
    const contribution = await PaymentService.getContribution(contact);

    if (!contribution.mandateId || !contribution.subscriptionId) {
      throw new Error("No mandate ID found");
    }

    if (contribution.nextAmount) {
      throw new Error("Next amount set");
    }

    const monthlyAmount = contact.contributionMonthlyAmount || 0;
    if (contribution.method === PaymentMethod.GoCardlessDirectDebit) {
      await gocardless.payments.create({
        amount: (monthlyAmount * 11 * 100).toString(),
        currency: PaymentCurrency.GBP,
        description: "One-off payment to switch to annual contribution",
        links: {
          mandate: contribution.mandateId
        }
      });
      await gocardless.subscriptions.cancel(contribution.subscriptionId);
      const newSub = await gocardless.subscriptions.create({
        amount: (monthlyAmount * 12 * 100).toString(),
        currency: PaymentCurrency.GBP,
        interval_unit: SubscriptionIntervalUnit.Monthly,
        name: "Membership",
        links: {
          mandate: contribution.mandateId
        },
        start_date: add(new Date(), { years: 1 }).toISOString()
      });

      contribution.subscriptionId = newSub.id!;
      await getRepository(ContactContribution).save(contribution);
    } else if (contribution.method === PaymentMethod.StripeCard) {
      const sub = await stripe.subscriptions.retrieve(
        contribution.subscriptionId
      );

      await stripe.subscriptions.update(contribution.subscriptionId, {
        items: [
          {
            id: sub.items.data[0].id,
            price_data: {
              currency: config.currencyCode,
              product: config.stripe.membershipProductId,
              recurring: {
                interval: "year"
              },
              unit_amount: monthlyAmount * 12 * 100
            }
          }
        ],
        proration_date: sub.current_period_end,
        proration_behavior: "always_invoice"
      });
    } else {
      throw new Error("Unsupported payment method");
    }

    await ContactsService.updateContact(contact, {
      contributionPeriod: ContributionPeriod.Annually
    });

    await ContactsService.extendContactRole(
      contact,
      "member",
      add(new Date(), { years: 1, ...config.gracePeriod })
    );

    await getRepository(ContactActivity).save({
      type: ActivityType.ChangeContribution,
      contactId: contact.id,
      data: {
        oldMonthlyAmount: monthlyAmount,
        oldPeriod: ContributionPeriod.Monthly,
        newMonthlyAmount: monthlyAmount,
        newPeriod: ContributionPeriod.Annually,
        startNow: true,
        prorate: true
      }
    });

    res.redirect("/switch-to-annual/success");
  })
);

export default app;
