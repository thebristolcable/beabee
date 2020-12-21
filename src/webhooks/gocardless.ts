import 'module-alias/register';

import bodyParser from 'body-parser';
import express from 'express';
import { Event, EventResourceType } from 'gocardless-nodejs/types/Types';

import { installMiddleware, log } from '@core/logging';
import * as db from '@core/database';
import gocardless from '@core/gocardless';

import PaymentWebhookService from '@core/services/PaymentWebhookService';

import config from '@config';

const app = express();
const textBodyParser = bodyParser.text( {
	type: 'application/json',
	limit: '1mb'
} );

// Add logging capabilities
installMiddleware( app );

app.get( '/ping', function( req, res ) {
	req.log.info( {
		app: 'webhook',
		action: 'ping'
	} );
	res.sendStatus( 200 );
} );

app.post( '/', textBodyParser, async function( req, res ) {
	const valid = gocardless.webhooks.validate( req );

	if ( valid ) {
		const events = JSON.parse( req.body ).events as Event[];

		req.log.info({
			app: 'webhook',
			action: 'main',
		}, `Got ${events.length} events`);

		try {
			for ( const event of events ) {
				req.log.info({
					app: 'webhook',
					action: 'handle-event',
				}, `Got ${event.action} on ${event.resource_type}`);

				await handleResourceEvent( event );
			}

			res.sendStatus( 200 );
		} catch ( error ) {
			req.log.error( {
				app: 'webhook',
				action: 'main',
				error
			} );
			res.status( 500 ).send( error );
		}
	} else {
		req.log.info( {
			app: 'webhook',
			action: 'main',
			error: 'invalid webhook signature'
		} );
		res.sendStatus( 498 );
	}
} );

// Start server
log.info( {
	app: 'webhook',
	action: 'start'
} );

db.connect(config.mongo).then(() => {
	const listener = app.listen( config.gocardless.port, config.host, function () {
		log.debug( {
			app: 'webhook',
			action: 'start-webserver',
			message: 'Started',
			address: listener.address()
		} );
	} );
});

async function handleResourceEvent( event: Event ) {
	switch( event.resource_type ) {
	case EventResourceType.Payments:
		return await handlePaymentResourceEvent( event );
	case EventResourceType.Subscriptions:
		return await handleSubscriptionResourceEvent( event );
	case EventResourceType.Mandates:
		return await handleMandateResourceEvent( event );
	case EventResourceType.Refunds:
		return await handleRefundResourceEvent( event );
	default:
		log.debug( {
			app: 'webhook',
			action: 'unhandled-resource-event',
			event
		} );
		break;
	}
}

async function handlePaymentResourceEvent( event: Event ) {
	// GC sends a paid_out action per payment when a payout is processed, which
	// means 1,000s of events.  In the docs they say you should always fetch the
	// related payment to check it hasn't changed, but if we do that we get rate
	// limited. It seems like we can pretty safely assume paid out payments
	// haven't changed though.
	if ( event.action === 'paid_out' ) {
		await PaymentWebhookService.updatePaymentStatus(event.links.payment, 'paid_out');
	} else {
		const payment = await PaymentWebhookService.updatePayment(event.links.payment);
		if (event.action === 'confirmed') {
			await PaymentWebhookService.confirmPayment(payment);
		}
	}
}

async function handleSubscriptionResourceEvent( event: Event ) {
	switch( event.action ) {
	case 'created':
	case 'customer_approval_granted':
	case 'payment_created':
	case 'amended':
		// Do nothing, we already have the details on file.
		break;
	case 'customer_approval_denied':
	case 'cancelled':
	case 'finished':
		await PaymentWebhookService.cancelSubscription(event.links.subscription);
		break;
	}
}

async function handleMandateResourceEvent( event: Event ) {
	switch( event.action ) {
	case 'created':
	case 'customer_approval_granted':
	case 'customer_approval_skipped':
	case 'submitted':
	case 'active':
	case 'transferred':
		// Do nothing, we already have the details on file.
		break;
	case 'reinstated':
		log.error( {
			app: 'webhook',
			action: 'reinstate-mandate',
			message: 'Mandate reinstated, its likely this mandate wont be linked to a member...',
			sensitive: {
				event: event
			}
		} );
		break;
	case 'cancelled':
	case 'failed':
	case 'expired':
		// Remove the mandate from the database
		await PaymentWebhookService.cancelMandate(event.links.mandate);
		break;
	}
}

async function handleRefundResourceEvent( event: Event ) {
	const refund = await gocardless.refunds.get( event.links.refund );
	await PaymentWebhookService.updatePayment(refund.links.payment);
}
