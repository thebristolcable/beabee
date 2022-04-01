import express from "express";
import { getRepository } from "typeorm";

import config from "@config";

import { isAdmin } from "@core/middleware";
import { wrapAsync } from "@core/utils";
import { canSuperAdmin } from "@core/utils/auth";

import GCPaymentService from "@core/services/GCPaymentService";
import MembersService from "@core/services/MembersService";
import OptionsService from "@core/services/OptionsService";
import PaymentService from "@core/services/PaymentService";
import ReferralsService from "@core/services/ReferralsService";

import LoginOverrideFlow from "@models/LoginOverrideFlow";
import Member from "@models/Member";
import ResetPasswordFlow from "@models/ResetPasswordFlow";

const app = express();

async function getAvailableTags(): Promise<string[]> {
  return OptionsService.getList("available-tags");
}

app.set("views", __dirname + "/views");

app.use(isAdmin);

app.use(
  wrapAsync(async (req, res, next) => {
    // Bit of a hack to get parent app params
    const member = await MembersService.findOne({
      where: { id: req.allParams.uuid },
      relations: ["profile"]
    });
    if (member) {
      req.model = member;
      res.locals.paymentData = await PaymentService.getPaymentData(member);
      next();
    } else {
      next("route");
    }
  })
);

app.get(
  "/",
  wrapAsync(async (req, res) => {
    const member = req.model as Member;
    const availableTags = await getAvailableTags();

    const rpFlow = await getRepository(ResetPasswordFlow).findOne({
      where: { member },
      order: { date: "DESC" }
    });
    const loFlow = await getRepository(LoginOverrideFlow).findOne({
      where: { member },
      order: { date: "DESC" }
    });

    res.render("index", {
      member,
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
    const member = req.model as Member;

    if (!req.body.action.startsWith("save-") && !canSuperAdmin(req)) {
      req.flash("error", "403");
      res.redirect(req.baseUrl);
      return;
    }

    switch (req.body.action) {
      case "save-about": {
        await MembersService.updateMemberProfile(member, {
          tags: req.body.tags || [],
          description: req.body.description || "",
          bio: req.body.bio || ""
        });
        req.flash("success", "member-updated");
        break;
      }
      case "save-contact":
        await MembersService.updateMember(member, {
          email: req.body.email
        });
        await MembersService.updateMemberProfile(member, {
          telephone: req.body.telephone || "",
          twitter: req.body.twitter || "",
          preferredContact: req.body.preferred || ""
        });
        req.flash("success", "member-updated");
        break;
      case "save-notes":
        await MembersService.updateMemberProfile(member, {
          notes: req.body.notes
        });
        req.flash("success", "member-updated");
        break;
      case "login-override":
        await getRepository(LoginOverrideFlow).save({ member });
        req.flash("success", "member-login-override-generated");
        break;
      case "password-reset":
        await getRepository(ResetPasswordFlow).save({ member });
        req.flash("success", "member-password-reset-generated");
        break;
      case "permanently-delete":
        // TODO: anonymise other data in poll answers
        //await PollAnswers.updateMany( { member }, { $set: { member: null } } );

        await ReferralsService.permanentlyDeleteMember(member);
        await GCPaymentService.permanentlyDeleteMember(member);

        await MembersService.permanentlyDeleteMember(member);

        req.flash("success", "member-permanently-deleted");
        res.redirect("/members");
        return;
    }

    res.redirect(req.baseUrl);
  })
);

app.get("/2fa", (req, res) => {
  res.render("2fa", { member: req.model });
});

app.post(
  "/2fa",
  wrapAsync(async (req, res) => {
    await MembersService.updateMember(req.model as Member, {
      otp: { key: null, activated: false }
    });
    req.flash("success", "2fa-disabled");
    res.redirect(req.baseUrl);
  })
);

export default app;
