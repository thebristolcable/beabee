import {
  ContributionPeriod,
  NewsletterStatus,
  RoleType,
  RoleTypes
} from "@beabee/beabee-common";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsDefined,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Validate,
  ValidateNested
} from "class-validator";

import { ContributionInfo } from "@core/utils";

import IsPassword from "@api/validators/IsPassword";

import Address from "@models/Address";

import { GetPaginatedQuery } from "@api/data/PaginatedData";
import { ForceUpdateContributionData } from "../ContributionData";

interface ContactData {
  email: string;
  firstname: string;
  lastname: string;
}

interface ContactProfileData {
  telephone: string;
  twitter: string;
  preferredContact: string;
  deliveryOptIn: boolean;
  deliveryAddress: Address | null;
  newsletterStatus: NewsletterStatus;
  newsletterGroups: string[];

  // Admin only
  tags?: string[];
  notes?: string;
  description?: string;
}

export class UpdateContactRoleData {
  @Type(() => Date)
  @IsDate()
  dateAdded!: Date;

  @Type(() => Date)
  @IsDate()
  @IsOptional()
  dateExpires!: Date | null;
}

export interface GetContactRoleData extends UpdateContactRoleData {
  role: RoleType;
}

export class CreateContactRoleData
  extends UpdateContactRoleData
  implements GetContactRoleData
{
  @IsIn(RoleTypes)
  role!: RoleType;
}

export interface GetContactData extends ContactData {
  id: string;
  joined: Date;
  lastSeen?: Date;
  contributionAmount?: number;
  contributionPeriod?: ContributionPeriod;
  activeRoles: RoleType[];
  profile?: ContactProfileData;
  roles?: GetContactRoleData[];
  contribution?: ContributionInfo;
}

export enum GetContactWith {
  Contribution = "contribution",
  Profile = "profile",
  Roles = "roles"
}

export class GetContactQuery {
  @IsArray()
  @IsOptional()
  @IsEnum(GetContactWith, { each: true })
  with?: GetContactWith[];
}

const contactSortFields = [
  "firstname",
  "lastname",
  "email",
  "joined",
  "lastSeen",
  "contributionMonthlyAmount",
  "membershipStarts",
  "membershipExpires"
] as const;

// TODO: Use a mixin to inherit from GetContactQuery?
export class GetContactsQuery extends GetPaginatedQuery {
  @IsArray()
  @IsOptional()
  @IsEnum(GetContactWith, { each: true })
  with?: GetContactWith[];

  @IsIn(contactSortFields)
  sort?: string;
}

class UpdateAddressData implements Address {
  @IsDefined()
  @IsString()
  line1!: string;

  @IsString()
  line2?: string;

  @IsDefined()
  @IsString()
  city!: string;

  @IsDefined()
  @IsString()
  postcode!: string;
}

class UpdateContactProfileData implements Partial<ContactProfileData> {
  @IsOptional()
  @IsString()
  telephone?: string;

  @IsOptional()
  @IsString()
  twitter?: string;

  @IsOptional()
  @IsString()
  preferredContact?: string;

  @IsOptional()
  @IsString({ each: true })
  newsletterGroups?: string[];

  @IsOptional()
  @IsBoolean()
  deliveryOptIn?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAddressData)
  deliveryAddress?: UpdateAddressData;

  @IsOptional()
  @IsEnum(NewsletterStatus)
  newsletterStatus?: NewsletterStatus;

  // Admin only

  @IsOptional()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateContactData implements ContactData {
  @IsEmail()
  email!: string;

  @IsString()
  firstname!: string;

  @IsString()
  lastname!: string;

  @IsOptional()
  @Validate(IsPassword)
  password?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateContactProfileData)
  profile?: UpdateContactProfileData;
}

export class CreateContactData extends UpdateContactData {
  @IsOptional()
  @ValidateNested()
  @Type(() => ForceUpdateContributionData)
  contribution?: ForceUpdateContributionData;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateContactRoleData)
  roles?: CreateContactRoleData[];
}
