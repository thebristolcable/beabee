import express from 'express';

import auth from '@core/authentication';
import { wrapAsync } from '@core/utils';

import OptionsService from '@core/services/OptionsService';

const app = express();

app.set( 'views', __dirname + '/views' );

app.use(auth.isSuperAdmin);

app.get( '/', function( req, res ) {
	const options = OptionsService.getAll();
	res.render( 'index', { options } );
} );

app.get( '/:key/edit', function( req, res ) {
	const option = OptionsService.get(req.params.key);
	if ( option ) {
		res.locals.breadcrumb.push( {
			name: option.key
		} );

		req.flash( 'warning', 'option-404' );
		res.render( 'edit', { option } );
	} else {
		res.redirect( '/settings/options' );
	}
} );

app.post( '/:key/edit', wrapAsync( async function( req, res ) {
	await OptionsService.set(req.params.key, req.body.value || '');
	req.flash( 'success', 'option-updated' );
	res.redirect( '/settings/options' );
} ) );

app.get( '/:key/reset', function( req, res ) {
	const option = OptionsService.get(req.params.key);
	if ( option ) {
		res.locals.breadcrumb.push( {
			name: option.key
		} );

		res.render( 'reset', { key: option.key } );
	} else {
		req.flash( 'warning', 'option-404' );
		res.redirect('/settings/options');
	}
} );

app.post( '/:key/reset', wrapAsync(async function( req, res ) {
	await OptionsService.reset(req.params.key);
	req.flash( 'success', 'option-reset' );
	res.redirect('/settings/options');
} ) );

export default app;
