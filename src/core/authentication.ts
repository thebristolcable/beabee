import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import passportLocal from 'passport-local';
import passportTotp from 'passport-totp';
import base32 from 'thirty-two';

const LocalStrategy = passportLocal.Strategy;
const TotpStrategy = passportTotp.Strategy;

import config from '@config';

import { Members } from '@core/database';
import { cleanEmailAddress, getNextParam, sleep } from '@core/utils';

import OptionsService from './services/OptionsService';
import { getRepository, IsNull, MoreThan } from 'typeorm';
import MemberPermission from '@models/MemberPermission';

export enum AuthenticationStatus {
	LOGGED_IN = 1,
	NOT_LOGGED_IN = 0,
	NOT_MEMBER = -1,
	NOT_ADMIN = -2,
	REQUIRES_2FA = -3
}

export function load( app: express.Express ): void {
	// Add support for local authentication in Passport.js
	passport.use( new LocalStrategy( {
		usernameField: 'email'
	}, async function( email, password, done ) {

		if ( email ) email = cleanEmailAddress(email);

		const user = await Members.findOne( { email } );
		if ( user ) {
			const tries = user.password.tries || 0;
			// Has account exceeded it's password tries?
			if ( tries >= config['password-tries'] ) {
				return done( null, false, { message: 'account-locked' } );
			}

			if ( !user.password.salt ) {
				return done( null, false, { message: 'login-failed' } );
			}

			const hash = await hashPassword( password, user.password.salt, user.password.iterations );
			if ( hash === user.password.hash ) {

				if ( user.password.reset_code ) {
					user.password.reset_code = undefined;
					await user.save();
					return done( null, { _id: user._id }, { message: 'password-reset-attempt' } );
				}

				if ( tries > 0 ) {
					user.password.tries = 0;
					await user.save();
					return done( null, { _id: user._id }, { message: OptionsService.getText( 'flash-account-attempts' ).replace( '%', tries.toString() ) } );
				}

				if ( user.password.iterations < config.iterations ) {
					user.password = await generatePassword(password);
					await user.save();
				}

				return done( null, { _id: user._id }, { message: 'logged-in' } );
			} else {
				// If password doesn't match, increment tries and save
				user.password.tries = tries + 1;
				await user.save();
			}
		}

		// Delay by 1 second to slow down password guessing
		await sleep(1000);
		return done( null, false, { message: 'login-failed' } );
	} ) );

	// Add support for TOTP authentication in Passport.js
	passport.use( new TotpStrategy( {
		window: 1,
	}, function( user, done ) {
		if ( user.otp.key ) {
			return done( null, base32.decode( user.otp.key ), 30 );
		}
		return done( null, false );
	})
	);


	// Passport.js serialise user function
	passport.serializeUser( function( data, done ) {
		done( null, data );
	} );

	// Passport.js deserialise user function
	passport.deserializeUser( async function( data, done ) {
		const member = await Members.findById( data._id ).populate( 'permissions.permission' );
		if ( member ) {
			// Update last seen
			member.last_seen = new Date();
			await member.save();

			const userPermissions = await getRepository(MemberPermission).find({
				where: [
					{memberId: member.id, dateExpires: IsNull()},
					{memberId: member.id, dateExpires: MoreThan(new Date())},
				]
			});

			const user = {
				...member,
				quickPermissions: ['loggedIn', ...userPermissions.map(up => up.permission)]
			};

			// Return user data
			return done( null, user );
		} else {
			// Display login required message if user _id not found.
			return done( null, false, { message: 'login-required' } );
		}
	} );

	// Include support for passport and sessions
	app.use( passport.initialize() );
	app.use( passport.session() );
}

// Used for generating an OTP secret for 2FA
// returns a base32 encoded string of random bytes
export function generateOTPSecret(): Promise<string> {
	return new Promise(resolve => {
		crypto.randomBytes( 16, function( ex, raw ) {
			const secret = base32.encode( raw );
			resolve(secret.toString().replace(/=/g, ''));
		} );
	});
}

// Used for generating activation codes for new accounts, discourse linking, and password reset
// returns a 10 byte / 20 character hex string
export function generateActivationCode(): Promise<string> {
	return new Promise(resolve => {
		crypto.randomBytes( 10, function( ex, code ) {
			resolve( code.toString( 'hex' ) );
		} );
	});
}

export function generateCode(): string {
	return crypto.randomBytes( 10 ).toString( 'hex' );
}

// Used to create a long salt for each individual user
// returns a 256 byte / 512 character hex string
export function generateSalt(): Promise<string> {
	return new Promise(resolve => {
		crypto.randomBytes( 256, function( ex, salt ) {
			resolve( salt.toString( 'hex' ) );
		} );
	});
}

// Hashes passwords through sha512 1000 times
// returns a 512 byte / 1024 character hex string
export function hashPassword( password: string, salt: string, iterations: number): Promise<string> {
	return new Promise(resolve => {
		crypto.pbkdf2( password, salt, iterations, 512, 'sha512', function( err, hash ) {
			resolve( hash.toString( 'hex' ) );
		} );
	});
}

// Utility function generates a salt and hash from a plain text password
export async function generatePassword( password: string ): Promise<{salt: string, hash: string, iterations: number}> {
	const salt = await generateSalt();
	const hash = await hashPassword(password, salt, config.iterations);
	return {
		salt, hash, iterations: config.iterations
	};
}

// Checks the user is logged in and activated.
export function loggedIn( req: Request ): AuthenticationStatus {
	// Is the user logged in?
	if ( req.isAuthenticated() && req.user ) {
		// Is the user active
		if ( ! req.user.otp.activated || ( req.user.otp.activated && req.session.method == 'totp' ) ) {
			return AuthenticationStatus.LOGGED_IN;
		} else {
			return AuthenticationStatus.REQUIRES_2FA;
		}
	} else {
		return AuthenticationStatus.NOT_LOGGED_IN;
	}
}

// Checks if the user is an active member (has paid or has admin powers)
export function activeMember( req: Request ): AuthenticationStatus {
	// Check user is logged in
	const status = loggedIn( req );
	if ( status != AuthenticationStatus.LOGGED_IN ) {
		return status;
	} else {
		if ( checkPermission( req, 'member' ) ) return AuthenticationStatus.LOGGED_IN;
		if ( checkPermission( req, 'superadmin' ) ) return AuthenticationStatus.LOGGED_IN;
		if ( checkPermission( req, 'admin' ) ) return AuthenticationStatus.LOGGED_IN;
	}
	return AuthenticationStatus.NOT_MEMBER;
}

// Checks if the user has an active admin or superadmin privilage
export function canAdmin( req: Request ): AuthenticationStatus {
	// Check user is logged in
	const status = loggedIn( req );
	if ( status != AuthenticationStatus.LOGGED_IN ) {
		return status;
	} else {
		if ( checkPermission( req, 'superadmin' ) ) return AuthenticationStatus.LOGGED_IN;
		if ( checkPermission( req, 'admin' ) ) return AuthenticationStatus.LOGGED_IN;
	}
	return AuthenticationStatus.NOT_ADMIN;
}

// Checks if the user has an active superadmin privilage
export function canSuperAdmin( req: Request ): AuthenticationStatus {
	// Check user is logged in
	const status = loggedIn( req );
	if ( status != AuthenticationStatus.LOGGED_IN ) {
		return status;
	} else {
		if ( checkPermission( req, 'superadmin' ) ) return AuthenticationStatus.LOGGED_IN;
	}
	return AuthenticationStatus.NOT_ADMIN;
}

// Checks if the user has an active specified permission
export function checkPermission( req: Request, permission: string ): boolean {
	return req.user ? req.user.quickPermissions.indexOf( permission ) !== -1 : false;
}

export function handleNotAuthed( status: AuthenticationStatus, req: Request, res: Response ): void {
	const nextUrl = req.method === 'GET' ? getNextParam(req.originalUrl) : '';

	switch ( status ) {
	case AuthenticationStatus.REQUIRES_2FA:
		res.redirect( '/otp' + nextUrl );
		return;
	default:
		req.flash( 'error', 'login-required' );
		res.redirect( '/login' + nextUrl );
		return;
	}
}

// Express middleware to redirect logged out users
export function isLoggedIn( req: Request, res: Response, next: NextFunction ): void {
	const status = loggedIn( req );

	switch ( status ) {
	case AuthenticationStatus.LOGGED_IN:
		return next();
	default:
		handleNotAuthed( status, req, res );
		return;
	}
}

export function isNotLoggedIn( req: Request, res: Response, next: NextFunction ): void {
	const status = loggedIn( req );
	switch ( status ) {
	case AuthenticationStatus.NOT_LOGGED_IN:
		return next();
	default:
		res.redirect( OptionsService.getText('user-home-url') );
		return;
	}
}

// Express middleware to redirect inactive members
export function isMember( req: Request, res: Response, next: NextFunction): void {
	const status = activeMember( req );
	switch ( status ) {
	case AuthenticationStatus.LOGGED_IN:
		return next();
	case AuthenticationStatus.NOT_MEMBER:
		req.flash( 'warning', 'inactive-membership' );
		res.redirect( OptionsService.getText('user-home-url') );
		return;
	default:
		handleNotAuthed( status, req, res );
		return;
	}
}

// Express middleware to redirect users without admin/superadmin privileges
export function isAdmin( req: Request, res: Response, next: NextFunction ): void {
	const status = canAdmin( req );
	switch ( status ) {
	case AuthenticationStatus.LOGGED_IN:
		return next();
	case AuthenticationStatus.NOT_ADMIN:
		req.flash( 'warning', '403' );
		res.redirect( OptionsService.getText('user-home-url') );
		return;
	default:
		handleNotAuthed( status, req, res );
		return;
	}
}

// Express middleware to redirect users without superadmin privilages
export function isSuperAdmin( req: Request, res: Response, next: NextFunction ): void {
	const status = canSuperAdmin( req );
	switch ( status ) {
	case AuthenticationStatus.LOGGED_IN:
		return next();
	case AuthenticationStatus.NOT_ADMIN:
		req.flash( 'warning', '403' );
		res.redirect( OptionsService.getText('user-home-url') );
		return;
	default:
		handleNotAuthed( status, req, res );
		return;
	}
}

// Checks password meets requirements
export function passwordRequirements( password: string ): string|true {
	if ( ! password )
		return 'password-err-length';

	if ( password.length < 8 )
		return 'password-err-length';

	if ( password.match( /\d/g ) === null )
		return 'password-err-number';

	if ( password.match( /[A-Z]/g ) === null )
		return 'password-err-letter-up';

	if ( password.match( /[a-z]/g ) === null )
		return 'password-err-letter-low';

	return true;
}
