import "module-alias/register";

import readline from "readline";
import { getManager } from "typeorm";

import config from "@config";
import * as db from "@core/database";

if (!config.dev) {
  console.error("Can't import to live database");
  process.exit(1);
}

db.connect().then(async () => {
  // File format: first line is SQL, second is params (repeated)
  try {
    await getManager().transaction(async (manager) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });

      let query = "";
      for await (const line of rl) {
        if (query) {
          console.log("Running " + query.substring(0, 100) + "...");
          await manager.query(
            query,
            line !== "" ? JSON.parse(line) : undefined
          );
          query = "";
        } else {
          query = line;
        }
      }
    });
  } catch (err) {
    console.error(err);
  }

  await db.close();
});
