import {
  CalloutResponseAnswer,
  CalloutResponseAnswerAddress,
  CalloutResponseAnswerFileUpload,
  CalloutResponseAnswers,
  Paginated,
  getCalloutComponents,
  stringifyAnswer
} from "@beabee/beabee-common";

import {
  GetCalloutResponseMapDto,
  GetCalloutResponseMapOptsDto,
  ListCalloutResponseMapDto,
  ListCalloutResponsesDto
} from "@api/dto/CalloutResponseDto";
import { BaseCalloutResponseTransformer } from "@api/transformers/BaseCalloutResponseTransformer";

import CalloutResponse from "@models/CalloutResponse";
import { mergeRules } from "@api/data/PaginatedData";
import Contact from "@models/Contact";
import { getRepository } from "@core/database";
import Callout, { CalloutResponseViewSchema } from "@models/Callout";
import NotFoundError from "@api/errors/NotFoundError";

class CalloutResponseMapTransformer extends BaseCalloutResponseTransformer<
  GetCalloutResponseMapDto,
  GetCalloutResponseMapOptsDto
> {
  convert(
    response: CalloutResponse,
    opts: GetCalloutResponseMapOptsDto
  ): GetCalloutResponseMapDto {
    let title = "",
      images: CalloutResponseAnswer[] = [],
      address: CalloutResponseAnswer | undefined;

    const {
      responseViewSchema: { map, titleProp, imageProp },
      formSchema
    } = opts.callout;

    const answers: CalloutResponseAnswers = Object.fromEntries(
      formSchema.slides.map((slide) => [slide.id, {}])
    );

    for (const component of getCalloutComponents(formSchema)) {
      // Skip components that shouldn't be displayed publicly
      if (component.adminOnly) {
        continue;
      }

      const answer = response.answers[component.slideId]?.[component.key];
      if (answer) {
        // answers[slideId] will definitely be defined
        answers[component.slideId]![component.key] = answer;
      }

      // Extract title, address and image answers
      if (component.fullKey === titleProp) {
        title = stringifyAnswer(component, answer);
      }
      if (component.fullKey === map?.addressProp) {
        address = Array.isArray(answer) ? answer[0] : answer;
      }
      if (component.fullKey === imageProp) {
        images = Array.isArray(answer) ? answer : [answer];
      }
    }

    return {
      number: response.number,
      answers,
      title,
      photos: images as CalloutResponseAnswerFileUpload[], // TODO: ensure type?
      ...(address && {
        address: address as CalloutResponseAnswerAddress // TODO: ensure type?
      })
    };
  }

  protected transformQuery(
    query: ListCalloutResponseMapDto
  ): ListCalloutResponseMapDto {
    return {
      ...query,
      rules: mergeRules([
        query.rules,
        // Only show results from relevant buckets
        {
          condition: "OR",
          rules: query.callout.responseViewSchema.buckets.map((bucket) => ({
            field: "bucket",
            operator: "equal",
            value: [bucket]
          }))
        }
      ])
    };
  }

  async fetchForCallout(
    caller: Contact | undefined,
    calloutSlug: string,
    query: ListCalloutResponsesDto
  ): Promise<Paginated<GetCalloutResponseMapDto>> {
    const callout = await getRepository(Callout).findOneBy({
      slug: calloutSlug
    });
    if (!callout?.responseViewSchema) {
      throw new NotFoundError();
    }

    const calloutWithSchema = callout as Callout & {
      responseViewSchema: CalloutResponseViewSchema;
    };

    return await super.fetch(caller, { ...query, callout: calloutWithSchema });
  }
}

export default new CalloutResponseMapTransformer();
