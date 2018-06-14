const test = require('ava');
const moment = require('moment');

const utils = require('../../tools/gocardless/sync-utils.js');

const __fixtures = '../fixtures/gocardless/sync';
const oneSubscription = require(__fixtures + '/oneSubscription.json');
const noSubscriptions = require(__fixtures + '/noSubscriptions.json');
const oneActiveSubscriptionWithSameEmail = require(__fixtures + '/oneActiveSubscriptionWithSameEmail.json');
const multipleActiveSubscriptionsWithSameEmail = require(__fixtures + '/multipleActiveSubscriptionsWithSameEmail.json');
const onlyPendingPayment = require(__fixtures + '/onlyPendingPayment.json');
const onlyFailedPayment = require(__fixtures + '/onlyFailedPayment.json');
const successfulAndPendingPayment = require(__fixtures + '/successfulAndPendingPayment.json');
const successfulAndFailedPayment = require(__fixtures + '/successfulAndFailedPayment.json');
const annualSubscription = require(__fixtures + '/annualSubscription.json');
const pendingPaymentWithAmountUpdate = require(__fixtures + '/pendingPaymentWithAmountUpdate.json');
const successfulPaymentWithAmountUpdate = require(__fixtures + '/successfulPaymentWithAmountUpdate.json');

// A not particularly thorough test that the data is merged into the right place
test('Merge data on one subscription', t => {
	const { customers, mandates, subscriptions, payments, subscriptionCancelledEvents } = oneSubscription;

	const mandate = {
		...mandates[0],
		subscriptions,
	};

	const subscription = {
		...subscriptions[0],
		payments,
		cancelledEvents: subscriptionCancelledEvents
	};

	t.deepEqual(utils.mergeData(oneSubscription), [
		{
			...customers[0],
			mandates: [mandate],
			subscriptions: [subscription],
			payments: payments.map(payment => ({
				...payment,
				subscription: subscriptions[0]
			})),
			activeMandates: [mandate],
			activeSubscriptions: [subscription],
			latestActiveMandate: mandate,
			latestActiveSubscription: subscription
		}
	]);
});

test('Active subscriptions filter', t => {
	const activeSubscriptions = oneActiveSubscriptionWithSameEmail.subscriptions.filter(utils.isActiveSubscription);
	t.is(activeSubscriptions.length, 1);
	t.is(activeSubscriptions[0].id, 'SB53DE80003DA4');
});

test('Valid customers filter', t => {
	function testFilterValidCustomers(data, expectedLength) {
		const customers = utils.filterValidCustomers(utils.mergeData(data));
		t.is(customers.length, expectedLength);
		return customers;
	}

	testFilterValidCustomers(oneSubscription, 1);
	const [customer] = testFilterValidCustomers(oneActiveSubscriptionWithSameEmail, 1);
	t.is(customer.id, 'CU3C875BFEB5FA');

	testFilterValidCustomers(noSubscriptions, 0);
	testFilterValidCustomers(multipleActiveSubscriptionsWithSameEmail, 0);
});

test('Membership info', t => {
	function testMembershipInfo(data, expected) {
		const [customer] = utils.mergeData(data);
		const info = utils.getMembershipInfo(customer);
		t.is(info.amount, expected.amount);
		t.is(info.period, expected.period);
		t.is(info.expires.toISOString(), expected.expires.toISOString());
		t.deepEqual(info.pendingUpdate, expected.pendingUpdate);
	}

	testMembershipInfo(onlyPendingPayment, {
		amount: 1,
		period: 'monthly',
		expires: moment('2018-06-09T06:38:44.172Z'),
		pendingUpdate: {}
	});

	testMembershipInfo(onlyFailedPayment, {
		amount: 2,
		period: 'monthly',
		expires: moment('2015-07-16T18:19:11.541Z'),
		pendingUpdate: {}
	});

	testMembershipInfo(oneSubscription, {
		amount: 3,
		period: 'monthly',
		expires: moment('2018-06-24'),
		pendingUpdate: {}
	});

	testMembershipInfo(successfulAndPendingPayment, {
		amount: 3,
		period: 'monthly',
		expires: moment('2018-06-19'),
		pendingUpdate: {}
	});

	testMembershipInfo(successfulAndFailedPayment, {
		amount: 1,
		period: 'monthly',
		expires: moment('2018-06-11'),
		pendingUpdate: {}
	});

	testMembershipInfo(annualSubscription, {
		amount: 1,
		period: 'annually',
		expires: moment('2019-03-04'),
		pendingUpdate: {}
	});

	testMembershipInfo(pendingPaymentWithAmountUpdate, {
		amount: 5,
		period: 'monthly',
		expires: moment('2018-06-12T18:55:47.172Z'),
		pendingUpdate: {
			amount: 12,
			date:  moment('2018-07-18').toDate()
		}
	});

	testMembershipInfo(successfulPaymentWithAmountUpdate, {
		amount: 9,
		period: 'annually',
		expires: moment('2018-11-22'),
		pendingUpdate: {
			amount: 20,
			date:  moment('2018-11-22').toDate()
		}
	});

	// TODO: just changed subscription
});
