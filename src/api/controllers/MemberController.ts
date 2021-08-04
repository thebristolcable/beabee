import { IsBoolean, IsEmail, IsEnum, IsObject, IsOptional, IsString, ValidateNested, ValidationError } from 'class-validator';
import { BadRequestError, Body, CurrentUser, Get, JsonController, Put } from 'routing-controllers';
import { getRepository } from 'typeorm';

import { NewsletterStatus } from '@core/providers/newsletter';

import MembersService from '@core/services/MembersService';

import { isDuplicateIndex } from '@core/utils';

import Address from '@models/Address';
import Member from '@models/Member';
import MemberProfile from '@models/MemberProfile';

class MemberProfileData {
	@IsBoolean()
	deliveryOptIn!: boolean

	@IsOptional()
	@IsObject()
	deliveryAddress?: Address

	@IsEnum(NewsletterStatus)
	newsletterStatus!: NewsletterStatus
}

class MemberData {
	@IsEmail()
	email!: string

	@IsString()
	firstname!: string

	@IsString()
	lastname!: string

	@ValidateNested()
	profile!: MemberProfileData
}

async function memberToApiMember(member: Member): Promise<MemberData> {
	const profile = await getRepository(MemberProfile).findOneOrFail({member});

	return {
		email: member.email,
		firstname: member.firstname,
		lastname: member.lastname,
		profile: {
			deliveryOptIn: !!profile.deliveryOptIn,
			deliveryAddress: profile.deliveryAddress,
			newsletterStatus: profile.newsletterStatus
		}
	};
}

@JsonController('/member')
export class MemberController {
	@Get('/me')
	async getMe(@CurrentUser({required: true}) member: Member): Promise<MemberData> {
		return await memberToApiMember(member);
	}

	@Put('/me')
	async updateMe(
		@CurrentUser({required: true}) member: Member,
		@Body() data: Partial<MemberData>
	): Promise<MemberData> {
		if (data.email || data.firstname || data.lastname) {
			try {
				await MembersService.updateMember(member, {
					email: data.email,
					firstname: data.firstname,
					lastname: data.lastname
				});
			} catch (error) {
				if (isDuplicateIndex(error, 'email')) {
					const duplicateEmailError: any = new BadRequestError();
					duplicateEmailError.errors = [{
						property: 'email',
						constraints: {
							'duplicate-email': 'Email address already in use'
						}
					}] as ValidationError[];
					throw duplicateEmailError;
				} else {
					throw error;
				}
			}
		}
		if (data.profile) {
			await MembersService.updateMemberProfile(member, data.profile);
		}
		return await memberToApiMember(member);
	}
}