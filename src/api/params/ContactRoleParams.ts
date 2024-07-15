import { RoleType, RoleTypes } from "@beabee/beabee-common";
import { IsIn, IsString } from "class-validator";

export class ContactRoleParams {
  // TODO: fix invalid UUIDs in Cable version
  @IsString()
  id!: string;

  @IsIn(RoleTypes)
  roleType!: RoleType;
}
