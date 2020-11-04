const gocardless = require( __js + '/gocardless' );
const mailchimp = require( __js + '/mailchimp' );

const MembersService = require( __js + '/services/MembersService' );

async function syncMemberDetails(member, oldEmail) {
	if ( member.isActiveMember ) {
		try {
			await mailchimp.mainList.updateMemberDetails( member, oldEmail );
		} catch (err) {
			if (err.response && err.response.status === 404) {
				await MembersService.addMemberToMailingLists(member);
			} else {
				throw err;
			}
		}
	}

	if ( member.gocardless.customer_id ) {
		await gocardless.customers.update( member.gocardless.customer_id, {
			email: member.email,
			given_name: member.firstname,
			family_name: member.lastname
		} );
	}
}

module.exports = {
	syncMemberDetails
};
