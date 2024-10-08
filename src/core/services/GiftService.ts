import { ContributionType, NewsletterStatus } from "@beabee/beabee-common";
import muhammara from "muhammara";
import moment from "moment";

import { getRepository } from "@core/database";
import { log as mainLogger } from "@core/logging";
import { stripe, Stripe } from "@core/lib/stripe";
import { isDuplicateIndex } from "@core/utils";
import { generateContactCode } from "@core/utils/contact";

import EmailService from "@core/services/EmailService";
import ContactsService from "@core/services/ContactsService";
import OptionsService from "@core/services/OptionsService";

import GiftFlow, { GiftForm } from "@models/GiftFlow";
import ContactRole from "@models/ContactRole";

import config from "@config";

import { Address } from "@type/address";

const log = mainLogger.child({ app: "gift-service" });

export default class GiftService {
  /**
   * Create a gift flow and return the Stripe session ID
   * @param giftForm
   * @returns Stripe session ID
   */
  static async createGiftFlow(giftForm: GiftForm): Promise<string> {
    log.info("Create gift flow", { giftForm });

    const giftFlow = await GiftService.createGiftFlowWithCode(giftForm);

    const params: Stripe.Checkout.SessionCreateParams = {
      success_url: config.audience + "/gift/thanks/" + giftFlow.id,
      cancel_url: config.audience + "/gift",
      customer_email: giftForm.fromEmail,
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            unit_amount: giftForm.months * giftForm.monthlyAmount * 100,
            currency: config.currencyCode.toLowerCase(),
            product_data: {
              name: `Gift membership - ${giftForm.months} month${
                giftForm.months != 1 ? "s" : ""
              }`
            }
          }
        }
      ]
    };

    if (OptionsService.getBool("tax-rate-enabled")) {
      params.subscription_data = {
        default_tax_rates: [
          OptionsService.getText("tax-rate-stripe-default-id")
        ]
      };
    }

    const session = await stripe.checkout.sessions.create(params);

    await getRepository(GiftFlow).update(giftFlow.id, {
      sessionId: session.id
    });

    return session.id;
  }

  static async completeGiftFlow(sessionId: string): Promise<void> {
    const giftFlow = await getRepository(GiftFlow).findOne({
      where: { sessionId }
    });

    log.info("Complete gift flow", { sessionId, giftFlowId: giftFlow?.id });

    if (giftFlow) {
      giftFlow.completed = true;
      await getRepository(GiftFlow).update(giftFlow.id, { completed: true });

      const { fromName, fromEmail, firstname, startDate } = giftFlow.giftForm;
      const now = moment.utc();

      // const giftCard = GiftService.createGiftCard(giftFlow.setupCode);
      // const attachments = [
      //   {
      //     type: "application/pdf",
      //     name: "Gift card.pdf",
      //     content: (giftCard as any).toString("base64")
      //   }
      // ];

      await EmailService.sendTemplateTo(
        "purchased-gift",
        { email: fromEmail, name: fromName },
        { fromName, gifteeFirstName: firstname, giftStartDate: startDate }
        // { attachments }
      );

      // Immediately process gifts for today
      if (moment.utc(startDate).isSame(now, "day")) {
        await GiftService.processGiftFlow(giftFlow, true);
      }
    }
  }

  static async processGiftFlow(
    giftFlow: GiftFlow,
    sendImmediately = false
  ): Promise<void> {
    log.info("Process gift flow " + giftFlow.id, {
      giftFlow: { ...giftFlow, giftForm: undefined },
      sendImmediately
    });

    const {
      firstname,
      lastname,
      email,
      deliveryAddress,
      months,
      monthlyAmount,
      fromName,
      message
    } = giftFlow.giftForm;
    const now = moment.utc();

    if (giftFlow.processed) return;

    const role = getRepository(ContactRole).create({
      type: "member",
      dateExpires: now.clone().add(months, "months").toDate()
    });

    const contact = await ContactsService.createContact(
      {
        firstname,
        lastname,
        email,
        contributionType: ContributionType.Gift,
        contributionMonthlyAmount: monthlyAmount,
        roles: [role]
      },
      {
        deliveryOptIn: !!deliveryAddress?.line1,
        deliveryAddress: deliveryAddress,
        newsletterStatus: NewsletterStatus.Subscribed,
        newsletterGroups: OptionsService.getList("newsletter-default-groups")
      }
    );

    giftFlow.processed = true;
    giftFlow.giftee = contact;
    await getRepository(GiftFlow).save(giftFlow);

    const sendAt = sendImmediately
      ? undefined
      : now.clone().startOf("day").add({ h: 9 }).toDate();
    await EmailService.sendTemplateToContact(
      "giftee-success",
      contact,
      { fromName, message: message || "", giftCode: giftFlow.setupCode },
      { sendAt }
    );
  }

  static async updateGiftFlowAddress(
    giftFlow: GiftFlow,
    giftAddress: Address | null,
    deliveryAddress: Address
  ): Promise<void> {
    log.info("Update gift flow address " + giftFlow.id);

    if (!giftFlow.processed) {
      await getRepository(GiftFlow).update(giftFlow.id, {
        giftForm: {
          giftAddress,
          deliveryAddress
        }
      });
    }
  }

  private static async createGiftFlowWithCode(
    giftForm: GiftFlow["giftForm"]
  ): Promise<GiftFlow> {
    try {
      const giftFlow = new GiftFlow();
      giftFlow.sessionId = "UNKNOWN";
      giftFlow.setupCode = generateContactCode(giftForm)!;
      giftFlow.giftForm = giftForm;
      await getRepository(GiftFlow).insert(giftFlow);
      return giftFlow;
    } catch (error) {
      if (isDuplicateIndex(error, "setupCode")) {
        return await GiftService.createGiftFlowWithCode(giftForm);
      }
      throw error;
    }
  }

  private static createGiftCard(code: string) {
    const inStream = new muhammara.PDFRStreamForFile(
      __dirname + "/../../static/pdfs/gift.pdf"
    );
    const outStream = new muhammara.PDFWStreamForBuffer();

    const pdfWriter = muhammara.createWriterToModify(inStream, outStream);
    const font = pdfWriter.getFontForFile(
      __dirname + "/../../static/fonts/Lato-Regular.ttf"
    );

    const pageModifier = new muhammara.PDFPageModifier(pdfWriter, 0, true);
    const context = pageModifier.startContext().getContext();

    context.cm(-1, 0, 0, -1, 406, 570);
    context.writeText("thebristolcable.org/gift/" + code, 0, 0, {
      font,
      size: 14,
      color: 0x000000
    });

    pageModifier.endContext().writePage();
    pdfWriter.end();

    return outStream.buffer;
  }
}
