import "module-alias/register";

import { subDays } from "date-fns";
import {
  EntityTarget,
  FindOptionsWhere,
  LessThan,
  ObjectLiteral
} from "typeorm";

import { log as mainLogger } from "@core/logging";
import * as db from "@core/database";

import LoginOverrideFlow from "@models/LoginOverrideFlow";
import JoinFlow from "@models/JoinFlow";
import ResetSecurityFlow from "@models/ResetSecurityFlow";

const log = mainLogger.child({ app: "clean-database" });

async function clean<T extends ObjectLiteral>(
  e: EntityTarget<T>,
  find: FindOptionsWhere<T>
) {
  const repo = db.getRepository(e);
  const { affected } = await repo.delete(find);
  log.info(`Cleaned ${affected} from ${repo.metadata.name}`);
}

db.connect().then(async () => {
  const now = new Date();

  await clean(LoginOverrideFlow, { date: LessThan(subDays(now, 3)) });
  await clean(ResetSecurityFlow, { date: LessThan(subDays(now, 7)) });

  await clean(JoinFlow, { date: LessThan(subDays(now, 28)) });

  await db.close();
});
