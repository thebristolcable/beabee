const _ = require('lodash');
const moment = require('moment');

const { Members, Permissions } = require(__js + '/database');
const config = require( __config );

async function getQuery() {
	const permission = await Permissions.findOne({slug: config.permission.member});
	return {
		permissions: {$elemMatch: {permission}}
	};
}

async function getExport(members) {
	const membershipDates = members.map(member => ({
		added: member.memberPermission.date_added,
		expires: member.memberPermission.date_expires
	}));

	const cancellationsByMonth = _(members)
		.filter(member => member.gocardless.cancelled_at)
		.map(member => member.gocardless.cancelled_at)
		.groupBy(date => moment(date).format('YYYY-MM'))
		.mapValues('length')
		.valueOf();

	const startDate = moment(membershipDates.map(d => d.added).sort()[0]).startOf('month');
	const endDate = moment().startOf('month');

	const exportData = [];
	while (startDate.isSameOrBefore(endDate)) {
		const date = startDate.format('YYYY-MM');
		const members = membershipDates.filter(({added, expires}) => startDate.isAfter(added) && startDate.isBefore(expires)).length;
		const cancellations = cancellationsByMonth[date] || 0;

		exportData.push({
			Date: date,
			Members: members,
			Cancellations: cancellations,
			ChurnRate: (cancellations / members).toFixed(3)
		});

		startDate.add(1, 'month');
	}

	return exportData;
}

module.exports = {
	name: 'Churn rate export',
	statuses: ['added', 'seen'],
	collection: Members,
	itemName: 'members',
	getQuery,
	getExport
};