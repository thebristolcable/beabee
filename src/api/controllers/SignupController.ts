import { IsBoolean, IsEmail, IsEnum, IsString, Min } from "class-validator";
import { Request } from "express";
import {
  Body,
  BodyParam,
  HttpError,
  JsonController,
  NotFoundError,
  OnUndefined,
  Post,
  Req
} from "routing-controllers";

import { ContributionPeriod, isDuplicateIndex } from "@core/utils";
import { generatePassword } from "@core/utils/auth";

import EmailService from "@core/services/EmailService";
import GCPaymentService from "@core/services/GCPaymentService";
import JoinFlowService, {
  CompletedJoinFlow
} from "@core/services/JoinFlowService";
import MembersService from "@core/services/MembersService";
import OptionsService from "@core/services/OptionsService";

import { NewsletterStatus } from "@core/providers/newsletter";

import Member from "@models/Member";

class SignupData {
  @IsEmail()
  email!: string;

  @IsString()
  // TODO: password requirement checks?
  password!: string;

  @Min(1)
  amount!: number;

  @IsEnum(ContributionPeriod)
  period!: ContributionPeriod;

  @IsBoolean()
  payFee!: boolean;

  @IsString()
  completeUrl!: string;
}

type SignupErrorCode =
  | "duplicate-email"
  | "confirm-email"
  | "restart-membership"
  | "confirm-email-failed";

class SignupError extends HttpError {
  constructor(readonly code: SignupErrorCode) {
    super(400);
    Object.setPrototypeOf(this, SignupError.prototype);
  }

  toJSON() {
    return {
      status: 400,
      code: this.code
    };
  }
}

interface SignupStart {
  redirectUrl: string;
}

async function handleJoin(
  req: Request,
  member: Member,
  joinFlow: CompletedJoinFlow
): Promise<void> {
  await GCPaymentService.updatePaymentMethod(
    member,
    joinFlow.customerId,
    joinFlow.mandateId
  );
  await GCPaymentService.updateContribution(member, joinFlow.joinForm);
  await EmailService.sendTemplateToMember("welcome", member);

  await MembersService.updateMember(member, { activated: true });

  // For now use existing session infrastructure with a cookie
  await new Promise<void>((resolve, reject) => {
    req.login(member, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

@JsonController("/signup")
export class SignupController {
  @Post("/")
  async startSignup(@Body() data: SignupData): Promise<SignupStart> {
    const redirectUrl = await JoinFlowService.createJoinFlow(
      data.completeUrl,
      {
        ...data,
        monthlyAmount:
          data.period === ContributionPeriod.Monthly
            ? data.amount
            : data.amount / 12,
        password: await generatePassword(data.password),
        prorate: false
      },
      {
        prefilled_customer: {
          email: data.email
        }
      }
    );
    return {
      redirectUrl
    };
  }

  @OnUndefined(204)
  @Post("/complete")
  async completeSignup(
    @Req() req: Request,
    @BodyParam("redirectFlowId") redirectFlowId: string
  ): Promise<void> {
    const joinFlow = await JoinFlowService.completeJoinFlow(redirectFlowId);
    if (!joinFlow) {
      throw new NotFoundError();
    }

    const { partialMember, partialProfile } =
      await GCPaymentService.customerToMember(joinFlow);

    try {
      const newMember = await MembersService.createMember(partialMember, {
        ...partialProfile,
        newsletterStatus: NewsletterStatus.Subscribed,
        newsletterGroups: OptionsService.getList("newsletter-default-groups")
      });
      await handleJoin(req, newMember, joinFlow);
    } catch (error) {
      if (isDuplicateIndex(error, "email")) {
        const oldMember = await MembersService.findOne({
          email: partialMember.email
        });
        // This should never be able to happen
        if (!oldMember) {
          throw error;
        }

        if (oldMember.isActiveMember) {
          throw new SignupError("duplicate-email");
        } else {
          const restartFlow = await JoinFlowService.createRestartFlow(
            oldMember,
            joinFlow
          );
          await EmailService.sendTemplateToMember(
            "join-confirm-email",
            oldMember,
            { code: restartFlow.id }
          );
          throw new SignupError(
            oldMember.activated ? "restart-membership" : "confirm-email"
          );
        }
      } else {
        throw error;
      }
    }
  }

  @OnUndefined(204)
  @Post("/confirm-email")
  async confirmEmail(
    @Req() req: Request,
    @BodyParam("restartFlowId") restartFlowId: string
  ): Promise<void> {
    const restartFlow = await JoinFlowService.completeRestartFlow(
      restartFlowId
    );
    if (!restartFlow) {
      throw new NotFoundError();
    }

    if (restartFlow.member.isActiveMember) {
      throw new SignupError("confirm-email-failed");
    } else {
      await handleJoin(req, restartFlow.member, restartFlow);
    }
  }
}
