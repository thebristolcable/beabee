import express from "express";
import moment from "moment";

import config from "@config";

import { getRepository } from "@core/database";
import { isAdmin } from "@core/middleware";
import { wrapAsync } from "@core/utils";
import { canSuperAdmin } from "@core/utils/auth";

import ContactsService from "@core/services/ContactsService";
import OptionsService from "@core/services/OptionsService";
import PaymentService from "@core/services/PaymentService";
import ReferralsService from "@core/services/ReferralsService";

import LoginOverrideFlow from "@models/LoginOverrideFlow";
import Contact from "@models/Contact";
import ResetSecurityFlow from "@models/ResetSecurityFlow";

import { RESET_SECURITY_FLOW_TYPE } from "@enums/reset-security-flow-type";

const app = express();

async function getAvailableTags(): Promise<string[]> {
  return OptionsService.getList("available-tags");
}

app.set("views", __dirname + "/views");

app.use(isAdmin);

app.use(
  wrapAsync(async (req, res, next) => {
    // Bit of a hack to get parent app params
    const contact = await ContactsService.findOne({
      where: { id: req.allParams.uuid },
      relations: { profile: true }
    });
    if (contact) {
      req.model = contact;
      const { method, ...contribution } =
        await PaymentService.getContribution(contact);
      res.locals.contribution = contribution;
      res.locals.paymentMethod = method;
      next();
    } else {
      next("route");
    }
  })
);

app.get(
  "/",
  wrapAsync(async (req, res) => {
    const contact = req.model as Contact;
    const availableTags = await getAvailableTags();

    const rpFlow = await getRepository(ResetSecurityFlow).findOne({
      where: { contactId: contact.id },
      order: { date: "DESC" }
    });
    const loFlow = await getRepository(LoginOverrideFlow).findOne({
      where: { contactId: contact.id },
      order: { date: "DESC" }
    });

    res.render("index", {
      member: contact,
      rpFlow,
      loFlow,
      availableTags,
      password_tries: config.passwordTries
    });
  })
);

app.post(
  "/",
  wrapAsync(async (req, res) => {
    const contact = req.model as Contact;

    if (!req.body.action.startsWith("save-") && !canSuperAdmin(req)) {
      req.flash("error", "403");
      res.redirect(req.baseUrl);
      return;
    }

    switch (req.body.action) {
      case "save-about": {
        await ContactsService.updateContactProfile(contact, {
          tags: req.body.tags || [],
          description: req.body.description || "",
          bio: req.body.bio || ""
        });
        req.flash("success", "member-updated");
        break;
      }
      case "save-contact":
        await ContactsService.updateContact(contact, {
          email: req.body.email
        });
        await ContactsService.updateContactProfile(contact, {
          telephone: req.body.telephone || "",
          twitter: req.body.twitter || "",
          preferredContact: req.body.preferred || ""
        });
        req.flash("success", "member-updated");
        break;
      case "save-notes":
        await ContactsService.updateContactProfile(contact, {
          notes: req.body.notes
        });
        req.flash("success", "member-updated");
        break;
      case "login-override":
        await getRepository(LoginOverrideFlow).save({ contact });
        req.flash("success", "member-login-override-generated");
        break;
      case "password-reset":
        await getRepository(ResetSecurityFlow).save({
          contact,
          type: RESET_SECURITY_FLOW_TYPE.PASSWORD
        });
        req.flash("success", "member-password-reset-generated");
        break;
      case "permanently-delete":
        await ContactsService.permanentlyDeleteContact(contact);

        req.flash("success", "member-permanently-deleted");
        res.redirect("/members");
        return;
    }

    res.redirect(req.baseUrl);
  })
);

export default app;
