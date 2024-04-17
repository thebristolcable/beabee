import {
  Authorized,
  Body,
  Get,
  JsonController,
  Params,
  Patch
} from "routing-controllers";

import PartialBody from "@api/decorators/PartialBody";
import {
  GetContactsContentDto,
  GetContentDto,
  GetEmailContentDto,
  GetGeneralContentDto,
  GetJoinContentDto,
  GetJoinSetupContentDto,
  GetProfileContentDto,
  GetShareContentDto
} from "@api/dto/ContentDto";
import { ContentParams } from "@api/params/ContentParams";
import ContentTransformer from "@api/transformers/ContentTransformer";
import { stripe, taxRateUpdateOrCreateDefault } from "@core/lib/stripe";

@JsonController("/content")
export class ContentController {
  @Get("/:id(?:*)")
  async get(@Params() { id }: ContentParams): Promise<GetContentDto> {
    return await ContentTransformer.fetchOne(id);
  }

  @Authorized("admin")
  @Patch("/contacts")
  async updateContacts(
    @PartialBody() data: GetContactsContentDto
  ): Promise<GetContactsContentDto> {
    await ContentTransformer.updateOne("contacts", data);
    return ContentTransformer.fetchOne("contacts");
  }

  @Authorized("admin")
  @Patch("/email")
  async updateEmail(
    @PartialBody() data: GetEmailContentDto
  ): Promise<GetEmailContentDto> {
    await ContentTransformer.updateOne("email", data);
    return ContentTransformer.fetchOne("email");
  }

  @Authorized("admin")
  @Patch("/general")
  async updateGeneral(
    @PartialBody() data: GetGeneralContentDto
  ): Promise<GetGeneralContentDto> {
    await ContentTransformer.updateOne("general", data);
    return ContentTransformer.fetchOne("general");
  }

  @Authorized("admin")
  @Patch("/join")
  async updateJoin(
    @PartialBody() data: GetJoinContentDto
  ): Promise<GetJoinContentDto> {
    if (data.taxRate) {
      const taxRate = await taxRateUpdateOrCreateDefault(
        {
          percentage: data.taxRate
        },
        data.taxRateStrapiId
      );
      data.taxRateStrapiId = taxRate.id;
    }
    await ContentTransformer.updateOne("join", data);
    return ContentTransformer.fetchOne("join");
  }

  @Authorized("admin")
  @Patch("/join/setup")
  async updateJoinSetup(
    @PartialBody() data: GetJoinSetupContentDto
  ): Promise<GetJoinSetupContentDto> {
    await ContentTransformer.updateOne("join/setup", data);
    return ContentTransformer.fetchOne("join/setup");
  }

  @Authorized("admin")
  @Patch("/profile")
  async updateProfile(
    @PartialBody() data: GetProfileContentDto
  ): Promise<GetProfileContentDto> {
    await ContentTransformer.updateOne("profile", data);
    return ContentTransformer.fetchOne("profile");
  }

  @Authorized("admin")
  @Patch("/share")
  async updateShare(
    @PartialBody() data: GetShareContentDto
  ): Promise<GetShareContentDto> {
    await ContentTransformer.updateOne("share", data);
    return ContentTransformer.fetchOne("share");
  }
}
