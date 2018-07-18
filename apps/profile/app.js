const __root = '../..';
const __src = __root + '/src';
const __js = __src + '/js';

const express = require( 'express' );

const auth = require( __js + '/authentication' );

const app = express();
var app_config = {};

app.set( 'views', __dirname + '/views' );

app.use( function( req, res, next ) {
	res.locals.app = app_config;
	res.locals.breadcrumb.push( {
		name: app_config.title,
		url: app.mountpath
	} );
	res.locals.activeApp = app_config.uid;

	if ( req.user && !req.user.setupComplete && req.originalUrl !== '/profile/complete') {
		res.redirect('/profile/complete');
	} else {
		next();
	}

} );

app.get( '/', auth.isLoggedIn, function( req, res ) {
	res.render( 'profile', { user: req.user } );
} );

module.exports = function( config ) {
	app_config = config;
	return app;
};
