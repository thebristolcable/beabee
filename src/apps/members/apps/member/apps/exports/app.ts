import express from "express";
import { createQueryBuilder, getRepository } from "typeorm";

import { wrapAsync } from "@core/utils";

import ExportTypes from "@apps/tools/apps/exports/exports";

import Contact from "@models/Contact";
import ExportItem from "@models/ExportItem";

const app = express();

app.set("views", __dirname + "/views");

app.get(
  "/",
  wrapAsync(async (req, res) => {
    const contact = req.model as Contact;
    const exportItems = await createQueryBuilder(ExportItem, "ei")
      .where("ei.itemId = :itemId", { itemId: contact.id })
      .leftJoinAndSelect("ei.export", "e")
      .orderBy("e.date")
      .getMany();

    const exportItemsWithTypes = exportItems
      .filter((item) => !!ExportTypes[item.export.type])
      .map((item) => ({
        ...item,
        type: new ExportTypes[item.export.type]()
      }));

    res.render("index", { exportItems: exportItemsWithTypes, member: contact });
  })
);

app.post(
  "/",
  wrapAsync(async (req, res) => {
    if (req.body.action === "update") {
      await getRepository(ExportItem).update(req.body.exportItemId, {
        status: req.body.status
      });
      req.flash("success", "exports-updated");
    }

    res.redirect(req.originalUrl);
  })
);

export default app;
