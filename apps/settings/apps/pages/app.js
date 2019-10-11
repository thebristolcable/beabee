const express = require( 'express' );
const _ = require( 'lodash' );

const auth = require( __js + '/authentication' );
const { PageSettings } = require( __js + '/database' );
const { hasModel, hasSchema } = require( __js + '/middleware' );
const { update: updatePageSettings } = require( __js + '/page-settings' );
const { wrapAsync } = require( __js + '/utils' );


const { createPageSchema } = require( './schema.json' );

const app = express();
var app_config = {};

app.set( 'views', __dirname + '/views' );

app.use( auth.isAdmin );

app.use( ( req, res, next ) => {
	res.locals.app = app_config;
	res.locals.breadcrumb.push( {
		name: app_config.title,
		url: app.mountpath
	} );
	res.locals.activeApp = 'pages';
	next();
} );

app.get( '/', wrapAsync( async ( req, res ) => {
	const pages = await PageSettings.find();
	res.render( 'index', { pages } );
} ) );

function schemaToPage( data ) {
	return _.pick(data, ['pattern', 'shareUrl', 'shareTitle', 'shareDescription', 'shareImage']);
}

app.post( '/', hasSchema( createPageSchema ).orFlash, wrapAsync( async ( req, res ) => {
	const page = await PageSettings.create( schemaToPage( req.body ) );
	req.flash('success', 'pages-created');
	res.redirect('/settings/pages/' + page._id);

	await updatePageSettings();
} ) );

app.get( '/:_id', hasModel(PageSettings, '_id'), ( req, res ) => {
	res.render( 'page', { page: req.model } );
} );

app.post( '/:_id', hasModel(PageSettings, '_id'), wrapAsync( async ( req, res ) => {
	switch ( req.body.action ) {
	case 'update':
		await req.model.update( { $set: schemaToPage( req.body ) } );
		req.flash( 'success', 'pages-updated' );
		res.redirect( '/settings/pages/' + req.model._id );
		break;

	case 'delete':
		await PageSettings.deleteOne({_id: req.model._id});
		req.flash( 'success', 'pages-deleted' );
		res.redirect( '/settings/pages' );
		break;
	}

	await updatePageSettings();
} ) );

module.exports = config => {
	app_config = config;
	return app;
};