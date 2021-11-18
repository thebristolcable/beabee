import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface
} from "class-validator";

import { ContributionPeriod } from "@core/utils";

@ValidatorConstraint({ name: "validPayFee" })
export default class ValidPayFee implements ValidatorConstraintInterface {
  validate(payFee: unknown, args: ValidationArguments): boolean {
    return typeof payFee === "boolean" && this.validPayFee(payFee, args);
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} is not valid`;
  }

  private validPayFee(payFee: boolean, args: ValidationArguments): boolean {
    const amount = (args.object as any)?.amount as unknown;
    const period = (args.object as any)?.period as unknown;
    // Annual contributions don't pay a fee
    if (payFee && period === ContributionPeriod.Annually) {
      return false;
    }
    // £1 monthly contributions must pay fee
    if (!payFee && period === ContributionPeriod.Monthly && amount === 1) {
      return false;
    }
    return true;
  }
}
