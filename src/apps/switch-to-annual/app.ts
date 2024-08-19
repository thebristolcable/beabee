import express, { Request } from "express";

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
import {
  PaymentCurrency,
  SubscriptionIntervalUnit
} from "gocardless-nodejs/types/Types";
import ContactContribution from "@models/ContactContribution";
import { stripe } from "@core/lib/stripe";
import { add, format } from "date-fns";

const app = express();

function getAmounts(req: Request) {
  const oldMonthlyAmount = req.user!.contributionMonthlyAmount || 0;
  const newAnnualAmount =
    Number(req.query.amount) || Math.max(oldMonthlyAmount, 5) * 12;
  const oneOffPayment = newAnnualAmount - oldMonthlyAmount;
  return { oldMonthlyAmount, newAnnualAmount, oneOffPayment };
}

app.set("views", __dirname + "/views");

app.get("/", isLoggedIn, (req, res) => {
  res.render("index", { user: req.user, ...getAmounts(req) });
});

app.get("/success", isLoggedIn, (req, res) => {
  res.render("success", { user: req.user, ...getAmounts(req) });
});

app.post(
  "/",
  isLoggedIn,
  wrapAsync(async (req, res, next) => {
    const contact = req.user as Contact;
    const contribution = await PaymentService.getContribution(contact);

    if (contact.contributionPeriod === ContributionPeriod.Annually) {
      return next("route");
    }

    if (!contribution.mandateId || !contribution.subscriptionId) {
      throw new Error("No mandate or subscription ID found");
    }

    if (contribution.nextAmount) {
      throw new Error("Next amount set");
    }

    const { oldMonthlyAmount, newAnnualAmount, oneOffPayment } =
      getAmounts(req);

    const newAnnualStartDate = add(new Date(), { years: 1 });

    // Handle GoCardless proration
    if (contribution.method === PaymentMethod.GoCardlessDirectDebit) {
      await gocardless.payments.create({
        amount: (oneOffPayment * 100).toString(),
        currency: config.currencyCode.toUpperCase() as PaymentCurrency,
        description: "One-off payment to switch to annual contribution",
        links: {
          mandate: contribution.mandateId
        }
      });

      // Cancel old subscription
      const oldSubscriptionId = contribution.subscriptionId;

      contribution.subscriptionId = null;
      await getRepository(ContactContribution).save(contribution);

      await gocardless.subscriptions.cancel(oldSubscriptionId);

      // Create new one
      const newSub = await gocardless.subscriptions.create({
        amount: (newAnnualAmount * 100).toString(),
        currency: config.currencyCode.toUpperCase() as PaymentCurrency,
        interval_unit: SubscriptionIntervalUnit.Yearly,
        name: "Membership",
        links: {
          mandate: contribution.mandateId
        },
        start_date: format(newAnnualStartDate, "yyyy-MM-dd")
      });

      contribution.subscriptionId = newSub.id!;
      await getRepository(ContactContribution).save(contribution);
      // Stripe handles proration by itself
    } else if (contribution.method === PaymentMethod.StripeCard) {
      const sub = await stripe.subscriptions.retrieve(
        contribution.subscriptionId
      );

      await stripe.subscriptions.update(contribution.subscriptionId, {
        billing_cycle_anchor: "now",
        proration_date: sub.current_period_start,
        proration_behavior: "always_invoice",
        items: [
          {
            id: sub.items.data[0].id,
            price_data: {
              currency: config.currencyCode,
              product: config.stripe.membershipProductId,
              recurring: {
                interval: "year"
              },
              unit_amount: newAnnualAmount * 100
            }
          }
        ]
      });
    } else {
      throw new Error("Unsupported payment method");
    }

    await getRepository(ContactActivity).save({
      type: ActivityType.ChangeContribution,
      contactId: contact.id,
      data: {
        oldMonthlyAmount: oldMonthlyAmount,
        oldPeriod: ContributionPeriod.Monthly,
        newMonthlyAmount: newAnnualAmount / 12,
        newPeriod: ContributionPeriod.Annually,
        startNow: true,
        prorate: true
      }
    });

    await ContactsService.updateContact(contact, {
      contributionMonthlyAmount: newAnnualAmount / 12,
      contributionPeriod: ContributionPeriod.Annually
    });

    await ContactsService.extendContactRole(
      contact,
      "member",
      add(newAnnualStartDate, config.gracePeriod)
    );

    res.redirect("/switch-to-annual/success?amount=" + newAnnualAmount);
  })
);

export default app;
