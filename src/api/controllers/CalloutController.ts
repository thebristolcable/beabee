import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  JsonController,
  NotFoundError,
  OnUndefined,
  Param,
  Params,
  Patch,
  Post,
  QueryParams
} from "routing-controllers";
import slugify from "slugify";
import { getRepository } from "typeorm";

import CalloutsService from "@core/services/CalloutsService";

import { isDuplicateIndex } from "@core/utils";

import Contact from "@models/Contact";
import Callout from "@models/Callout";
import CalloutResponse from "@models/CalloutResponse";

import {
  convertCalloutToData,
  CreateCalloutData,
  fetchCallout,
  fetchPaginatedCallouts,
  GetCalloutData,
  GetCalloutQuery,
  GetCalloutsQuery
} from "@api/data/CalloutData";
import {
  CreateCalloutResponseData,
  fetchCalloutResponse,
  fetchPaginatedCalloutResponses,
  GetCalloutResponseData,
  GetCalloutResponseParam,
  GetCalloutResponseQuery,
  GetCalloutResponsesQuery
} from "@api/data/CalloutResponseData";
import { mergeRules, Paginated } from "@api/data/PaginatedData";
import PartialBody from "@api/decorators/PartialBody";
import DuplicateId from "@api/errors/DuplicateId";
import InvalidCalloutResponse from "@api/errors/InvalidCalloutResponse";

@JsonController("/callout")
export class CalloutController {
  @Get("/")
  async getCallouts(
    @CurrentUser({ required: false }) contact: Contact | undefined,
    @QueryParams() query: GetCalloutsQuery
  ): Promise<Paginated<GetCalloutData>> {
    return fetchPaginatedCallouts(query, contact);
  }

  @Authorized("admin")
  @Post("/")
  async createCallout(
    @Body() data: CreateCalloutData
  ): Promise<GetCalloutData> {
    const callout = await CalloutsService.createCallout(
      {
        ...data,
        slug: data.slug || slugify(data.title, { lower: true })
      },
      data.slug ? false : 0
    );
    return convertCalloutToData(callout);
  }

  @Get("/:slug")
  async getCallout(
    @CurrentUser({ required: false }) contact: Contact | undefined,
    @Param("slug") slug: string,
    @QueryParams() query: GetCalloutQuery
  ): Promise<GetCalloutData | undefined> {
    return await fetchCallout({ slug }, query, contact);
  }

  @Authorized("admin")
  @Patch("/:slug")
  async updateCallout(
    @CurrentUser({ required: true }) contact: Contact,
    @Param("slug") slug: string,
    @PartialBody() data: CreateCalloutData // Should be Partial<CreateCalloutData>
  ): Promise<GetCalloutData | undefined> {
    const newSlug = data.slug || slug;
    await getRepository(Callout).update(slug, data);
    try {
      return await fetchCallout({ slug: newSlug }, {}, contact);
    } catch (err) {
      throw isDuplicateIndex(err, "slug") ? new DuplicateId(newSlug) : err;
    }
  }

  @Authorized("admin")
  @OnUndefined(204)
  @Delete("/:slug")
  async deleteCallout(@Param("slug") slug: string): Promise<void> {
    await getRepository(CalloutResponse).delete({ callout: { slug } });
    const result = await getRepository(Callout).delete(slug);
    if (result.affected === 0) {
      throw new NotFoundError();
    }
  }

  @Get("/:slug/responses")
  async getCalloutResponses(
    @CurrentUser() contact: Contact,
    @Param("slug") slug: string,
    @QueryParams() query: GetCalloutResponsesQuery
  ): Promise<Paginated<GetCalloutResponseData>> {
    const scopedQuery = mergeRules(query, [
      { field: "callout", operator: "equal", value: [slug] }
    ]);

    return await fetchPaginatedCalloutResponses(scopedQuery, contact);
  }

  @Post("/:slug/responses")
  @OnUndefined(204)
  async createCalloutResponse(
    @CurrentUser({ required: false }) contact: Contact | undefined,
    @Param("slug") slug: string,
    @Body() data: CreateCalloutResponseData
  ): Promise<void> {
    const callout = await getRepository(Callout).findOne(slug);
    if (!callout) {
      throw new NotFoundError();
    }

    if (contact && (data.guestEmail || data.guestName)) {
      throw new InvalidCalloutResponse("logged-in-guest-fields");
    }

    const error = contact
      ? await CalloutsService.setResponse(callout, contact, data.answers)
      : await CalloutsService.setGuestResponse(
          callout,
          data.guestName,
          data.guestEmail,
          data.answers
        );

    if (error) {
      throw new InvalidCalloutResponse(error);
    }
  }

  @Get("/:slug/responses/:id")
  async getCalloutResponse(
    @CurrentUser() contact: Contact,
    @Params() param: GetCalloutResponseParam,
    @QueryParams() query: GetCalloutResponseQuery
  ): Promise<GetCalloutResponseData | undefined> {
    return await fetchCalloutResponse(
      { id: param.id, callout: { slug: param.slug } },
      query,
      contact
    );
  }
}
