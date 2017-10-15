"use strict";

function CLoginPromptManager( strBaseURL, rgOptions )
{
	// normalize with trailing slash
	this.m_strBaseURL = strBaseURL + ( strBaseURL.substr(-1) == '/' ? '' : '/' ) + ( this.m_bIsMobile ? 'mobilelogin' : 'login' ) + '/';

	// read options
	rgOptions = rgOptions || {};
	this.m_bIsMobile = rgOptions.bIsMobile || false;
	this.m_strMobileClientType = rgOptions.strMobileClientType || '';
	this.m_strMobileClientVersion = rgOptions.strMobileClientVersion || '';
	this.m_bIsMobileSteamClient = ( this.m_strMobileClientType ? true : false );

	this.m_$LogonForm = $JFromIDOrElement( rgOptions.elLogonForm || document.forms['logon'] );

	this.m_fnOnFailure = rgOptions.fnOnFailure || null;
	this.m_fnOnSuccess = rgOptions.fnOnSuccess || null;

	this.m_strRedirectURL = rgOptions.strRedirectURL || (this.m_bIsMobile ? '' : strBaseURL);
	this.m_strSessionID = rgOptions.strSessionID || null;

	this.m_strUsernameEntered = null;
	this.m_strUsernameCanonical = null;

	if ( rgOptions.gidCaptcha )
		this.UpdateCaptcha( rgOptions.gidCaptcha );
	else
		this.RefreshCaptcha();	// check if needed


	this.m_bLoginInFlight = false;
	this.m_bInEmailAuthProcess = false;
	this.m_bInTwoFactorAuthProcess = false;
	this.m_TwoFactorModal = null;
	this.m_bEmailAuthSuccessful = false;
	this.m_bLoginTransferInProgress = false;
	this.m_bEmailAuthSuccessfulWantToLeave = false;
	this.m_bTwoFactorAuthSuccessful = false;
	this.m_bTwoFactorAuthSuccessfulWantToLeave = false;
	this.m_sOAuthRedirectURI = 'steammobile://mobileloginsucceeded';
	this.m_sAuthCode = "";
	this.m_sPhoneNumberLastDigits = "??";
	this.m_bTwoFactorReset = false;

	// values we collect from the user
	this.m_steamidEmailAuth = '';


	// record keeping
	this.m_iIncorrectLoginFailures = 0;	// mobile reveals password after a couple failures

	var _this = this;

	this.m_$LogonForm.submit( function(e) {
		_this.DoLogin();
		e.preventDefault();
	});
	// find buttons and make them clickable
	$J('#login_btn_signin' ).children('a, button' ).click( function() { _this.DoLogin(); } );

	this.InitModalContent();

	// these modals need to be in the body because we refer to elements by name before they are ready
	this.m_$ModalAuthCode = this.GetModalContent( 'loginAuthCodeModal' );
	this.m_$ModalAuthCode.find('[data-modalstate]' ).each( function() {
		$J(this).click( function() { _this.SetEmailAuthModalState( $J(this).data('modalstate') ); } );
	});
	this.m_$ModalAuthCode.find('form').submit( function(e) {
		_this.SetEmailAuthModalState('submit');
		e.preventDefault();
	});
	this.m_EmailAuthModal = null;

	this.m_$ModalIPT = this.GetModalContent( 'loginIPTModal' );

	this.m_$ModalTwoFactor = this.GetModalContent( 'loginTwoFactorCodeModal' );
	this.m_$ModalTwoFactor.find( '[data-modalstate]' ).each( function() {
		$J(this).click( function() { _this.SetTwoFactorAuthModalState( $J(this).data('modalstate') ); } );
	});
	this.m_$ModalTwoFactor.find( 'form' ).submit( function(e) {
		// Prevent submit if nothing was entered
		if ( $J('#twofactorcode_entry').val() != '' )
		{
			// Push the left button
			var $btnLeft = _this.m_$ModalTwoFactor.find( '.auth_buttonset:visible .auth_button.leftbtn ' );
			$btnLeft.trigger( 'click' );
		}

		e.preventDefault();
	});



	// register to listen to IOS two factor callback
	$J(document).on('SteamMobile_ReceiveAuthCode', function( e, authcode ) {
		_this.m_sAuthCode = authcode;
	});

	$J('#captchaRefreshLink' ).click( $J.proxy( this.RefreshCaptcha, this ) );

	// include some additional scripts we may need
	if ( typeof BigNumber == 'undefined' )
		$J.ajax( { url: 'https://steamcommunity-a.akamaihd.net/public/shared/javascript/crypto/jsbn.js', type: 'get', dataType: 'script', cache: true } );
	if ( typeof RSA == 'undefined' )
		$J.ajax( { url: 'https://steamcommunity-a.akamaihd.net/public/shared/javascript/crypto/rsa.js', type: 'get', dataType: 'script', cache: true } );
}

CLoginPromptManager.prototype.BIsIos = function() { return this.m_strMobileClientType == 'ios'; };
CLoginPromptManager.prototype.BIsAndroid = function() { return this.m_strMobileClientType == 'android'; };
CLoginPromptManager.prototype.BIsWinRT = function() { return this.m_strMobileClientType == 'winrt'; };

CLoginPromptManager.prototype.BIsUserInMobileClientVersionOrNewer = function( nMinMajor, nMinMinor, nMinPatch ) {
	if ( (!this.BIsIos() && !this.BIsAndroid() && !this.BIsWinRT() ) || this.m_strMobileClientVersion == '' )
		return false;

	var version = this.m_strMobileClientVersion.match( /(?:(\d+) )?\(?(\d+)\.(\d+)(?:\.(\d+))?\)?/ );
	if ( version && version.length >= 3 )
	{
		var nMajor = parseInt( version[2] );
		var nMinor = parseInt( version[3] );
		var nPatch = parseInt( version[4] );

		return nMajor > nMinMajor || ( nMajor == nMinMajor && ( nMinor > nMinMinor || ( nMinor == nMinMinor && nPatch >= nMinPatch ) ) );
	}
};

CLoginPromptManager.prototype.GetParameters = function( rgParams )
{
	var rgDefaultParams = { 'donotcache': new Date().getTime() };
	if ( this.m_strSessionID )
		rgDefaultParams['sessionid'] = this.m_strSessionID;

	return $J.extend( rgDefaultParams, rgParams );
};

CLoginPromptManager.prototype.$LogonFormElement = function( strElementName )
{
	var $Form = this.m_$LogonForm;
	var elInput = this.m_$LogonForm[0].elements[ strElementName ];

	if ( !elInput )
	{
		var $Input = $J('<input/>', {type: 'hidden', name: strElementName } );
		$Form.append( $Input );
		return $Input;
	}
	else
	{
		return $J( elInput );
	}
};

CLoginPromptManager.prototype.HighlightFailure = function( msg )
{
	if ( this.m_fnOnFailure )
	{
		this.m_fnOnFailure( msg );

		// always blur on mobile so the error can be seen
		if ( this.m_bIsMobile && msg )
			$J('input:focus').blur();
	}
	else
	{
		var $ErrorElement = $J('#error_display');

		if ( msg )
		{
			$ErrorElement.text( msg );
			$ErrorElement.slideDown();

			if ( this.m_bIsMobile )
				$J('input:focus').blur();
		}
		else
		{
			$ErrorElement.hide();
		}
	}
};


//Refresh the catpcha image 
CLoginPromptManager.prototype.RefreshCaptcha = function()
{
	var _this = this;
	$J.post( this.m_strBaseURL + 'refreshcaptcha/', this.GetParameters( {} ) )
		.done( function( data ) {
			_this.UpdateCaptcha( data.gid );
		});
};

CLoginPromptManager.prototype.UpdateCaptcha = function( gid )
{
	if ( gid != -1 )
	{
		$J('#captcha_entry').show();
		$J('#captchaImg').attr( 'src', this.m_strBaseURL + 'rendercaptcha/?gid='+gid );
		this.$LogonFormElement('captcha_text').val('');
	}
	else
	{
		$J('#captcha_entry' ).hide();
	}
	this.m_gidCaptcha = gid;
};

CLoginPromptManager.prototype.DoLogin = function()
{
	var form = this.m_$LogonForm[0];

	var username = form.elements['username'].value;
	this.m_strUsernameEntered = username;
	username = username.replace( /[^\x00-\x7F]/g, '' ); // remove non-standard-ASCII characters
	this.m_strUsernameCanonical = username;

	var password = form.elements['password'].value;
	password = password.replace( /[^\x00-\x7F]/g, '' ); // remove non-standard-ASCII characters

	if ( this.m_bLoginInFlight || password.length == 0 || username.length == 0 )
		return;

	this.m_bLoginInFlight = true;
	$J('#login_btn_signin').hide();
	$J('#login_btn_wait').show();

	// reset some state
	this.HighlightFailure( '' );

	var _this = this;
	$J.post( this.m_strBaseURL + 'getrsakey/', this.GetParameters( { username: username } ) )
		.done( $J.proxy( this.OnRSAKeyResponse, this ) )
		.fail( function () {
			ShowAlertDialog( 'Chyba', 'Při komunikaci se servery služby Steam došlo k chybě. Zkuste to prosím později znovu.' );
			$J('#login_btn_signin').show();
			$J('#login_btn_wait').hide();
			_this.m_bLoginInFlight = false;
		});
};

// used to get mobile client to execute a steammobile URL
CLoginPromptManager.prototype.RunLocalURL = function(url)
{
	var $IFrame = $J('<iframe/>', {src: url} );
	$J(document.body).append( $IFrame );

	// take it back out immediately
	$IFrame.remove();
};

var g_interval = null;

// read results from Android or WinRT clients
CLoginPromptManager.prototype.GetValueFromLocalURL = function( url, callback )
{
	window.g_status = null;
	window.g_data = null;
	this.RunLocalURL( url );

	var timeoutTime = Date.now() + 1000 * 5;

	if ( g_interval != null )
	{
		window.clearInterval( g_interval );
		g_interval = null;
	}

	// poll regularly (but gently) for an update.
	g_interval = window.setInterval( function() {
		var status = window.SGHandler.getResultStatus();
		if ( status && status != 'busy' )
		{
			if ( g_interval )
				window.clearInterval( g_interval );

			var value = window.SGHandler.getResultValue();
			callback( [ status, value ] );
			return;
		}
		if ( Date.now() > timeoutTime )
		{
			if ( g_interval )
				window.clearInterval( g_interval );
			callback( ['error', 'timeout'] );
			return;
		}
	}, 100);
};

// this function is invoked by iOS after the steammobile:// url is triggered by GetAuthCode.
//	we post an event to the dom to let any login handlers deal with it.
function receiveAuthCode( code )
{
	$J(document).trigger( 'SteamMobile_ReceiveAuthCode', [ code ] );
};

CLoginPromptManager.prototype.GetAuthCode = function( results, callback )
{
	if ( this.m_bIsMobile )
	{
		//	honor manual entry before anything else
		var code = $J('#twofactorcode_entry').val();
		if ( code.length > 0 )
		{
			callback( results, code );
			return;
		}

		if ( this.BIsIos() )
		{
			this.m_sAuthCode = '';
			this.RunLocalURL( "steammobile://twofactorcode?gid=" + results.token_gid );

			// this is expected to trigger receiveAuthCode and we'll have this value set by the time it's done
			if ( this.m_sAuthCode.length > 0 )
			{
				callback( results, this.m_sAuthCode );
				return;
			}
		}
		else if ( this.BIsAndroid() || this.BIsWinRT() )
		{
			var result = this.GetValueFromLocalURL('steammobile://twofactorcode?gid=' + results.token_gid, function(result) {
				if ( result[0] == 'ok' )
				{
					callback(results, result[1]);
				} else {
					// this may be in the modal
					callback(results, $J('#twofactorcode_entry').val());
				}
			});
			return;
		}

		// this may be in the modal
		callback(results, $J('#twofactorcode_entry').val());
	}
	else
	{
		var authCode = this.m_sAuthCode;
		this.m_sAuthCode = '';
		callback( results, authCode );
	}
};


CLoginPromptManager.prototype.OnRSAKeyResponse = function( results )
{
	if ( results.publickey_mod && results.publickey_exp && results.timestamp )
	{
		this.GetAuthCode( results , $J.proxy(this.OnAuthCodeResponse, this) );
	}
	else
	{
		if ( results.message )
		{
			this.HighlightFailure( results.message );
		}

		$J('#login_btn_signin').show();
		$J('#login_btn_wait').hide();

		this.m_bLoginInFlight = false;
	}
};

CLoginPromptManager.prototype.OnAuthCodeResponse = function( results, authCode )
{
	var form = this.m_$LogonForm[0];
	var pubKey = RSA.getPublicKey(results.publickey_mod, results.publickey_exp);
	var username = this.m_strUsernameCanonical;
	var password = form.elements['password'].value;
	password = password.replace(/[^\x00-\x7F]/g, ''); // remove non-standard-ASCII characters
	var encryptedPassword = RSA.encrypt(password, pubKey);

	var rgParameters = {
		password: encryptedPassword,
		username: username,
		twofactorcode: authCode,
		emailauth: form.elements['emailauth'] ? form.elements['emailauth'].value : '',
		loginfriendlyname: form.elements['loginfriendlyname'] ? form.elements['loginfriendlyname'].value : '',
		captchagid: this.m_gidCaptcha,
		captcha_text: form.elements['captcha_text'] ? form.elements['captcha_text'].value : '',
		emailsteamid: this.m_steamidEmailAuth,
		rsatimestamp: results.timestamp,
		remember_login: ( form.elements['remember_login'] && form.elements['remember_login'].checked ) ? 'true' : 'false'
	};

	if (this.m_bIsMobile)
		rgParameters.oauth_client_id = form.elements['oauth_client_id'].value;

	var _this = this;
	$J.post(this.m_strBaseURL + 'dologin/', this.GetParameters(rgParameters))
		.done($J.proxy(this.OnLoginResponse, this))
		.fail(function () {
			ShowAlertDialog('Error', 'There was a problem communicating with the Steam servers.  Please try again later.');

			$J('#login_btn_signin').show();
			$J('#login_btn_wait').hide();
			_this.m_bLoginInFlight = false;
		});
};


CLoginPromptManager.prototype.OnLoginResponse = function( results )
{
	this.m_bLoginInFlight = false;
	var bRetry = true;

	if ( results.login_complete )
	{
		if ( this.m_bIsMobile && results.oauth )
		{
			if( results.redirect_uri )
			{
				this.m_sOAuthRedirectURI = results.redirect_uri;
			}

			this.$LogonFormElement('oauth' ).val( results.oauth );
			bRetry = false;
			this.LoginComplete();
			return;
		}

		var bRunningTransfer = false;
		if ( ( results.transfer_url || results.transfer_urls ) && results.transfer_parameters )
		{
			bRunningTransfer = true;
			this.TransferLogin( results.transfer_urls || [ results.transfer_url ], results.transfer_parameters );
		}

		if ( this.m_bInEmailAuthProcess )
		{
			this.m_bEmailAuthSuccessful = true;
			this.SetEmailAuthModalState( 'success' );
		}
		else if ( this.m_bInTwoFactorAuthProcess )
		{
			this.m_bTwoFactorAuthSuccessful = true;
			this.SetTwoFactorAuthModalState( 'success' );
		}
		else
		{
			bRetry = false;
			if ( !bRunningTransfer )
				this.LoginComplete();
		}
	}
	else
	{
		// if there was some kind of other error while doing email auth or twofactor, make sure
		//	the modals don't get stuck
		if ( !results.emailauth_needed && this.m_EmailAuthModal )
			this.m_EmailAuthModal.Dismiss();

		if ( !results.requires_twofactor && this.m_TwoFactorModal )
			this.m_TwoFactorModal.Dismiss();

		if ( results.requires_twofactor )
		{
			$J('#captcha_entry').hide();

			if ( !this.m_bInTwoFactorAuthProcess )
				this.StartTwoFactorAuthProcess();
			else
				this.SetTwoFactorAuthModalState( 'incorrectcode' );
		}
		else if ( results.captcha_needed && results.captcha_gid )
		{
			this.UpdateCaptcha( results.captcha_gid );
			this.m_iIncorrectLoginFailures ++;
		}
		else if ( results.emailauth_needed )
		{
			if ( results.emaildomain )
				$J('#emailauth_entercode_emaildomain').text( results.emaildomain );

			if ( results.emailsteamid )
				this.m_steamidEmailAuth = results.emailsteamid;

			if ( !this.m_bInEmailAuthProcess )
				this.StartEmailAuthProcess();
			else
				this.SetEmailAuthModalState( 'incorrectcode' );
		}
		else if ( results.denied_ipt )
		{
			ShowDialog( 'Technologie Intel® Identity Protection', this.m_$ModalIPT.show() ).always( $J.proxy( this.ClearLoginForm, this ) );
		}
		else
		{
			this.m_strUsernameEntered = null;
			this.m_strUsernameCanonical = null;
			this.m_iIncorrectLoginFailures ++;
		}

		if ( results.message )
		{
			this.HighlightFailure( results.message );
			if ( this.m_bIsMobile && this.m_iIncorrectLoginFailures > 1 && !results.emailauth_needed && !results.bad_captcha )
			{
				// 2 failed logins not due to Steamguard or captcha, un-obfuscate the password field
				$J( '#passwordclearlabel' ).show();
				$J( '#steamPassword' ).val('');
				$J( '#steamPassword' ).attr( 'type', 'text' );
				$J( '#steamPassword' ).attr( 'autocomplete', 'off' );
			}
			else if ( results.clear_password_field )
			{
				$J( '#input_password' ).val('');
				$J( '#input_password' ).focus();
			}

		}
	}
	if ( bRetry )
	{
		$J('#login_btn_signin').show();
		$J('#login_btn_wait').hide();
	}
};

CLoginPromptManager.prototype.ClearLoginForm = function()
{
	var rgElements = this.m_$LogonForm[0].elements;
	rgElements['username'].value = '';
	rgElements['password'].value = '';
	if ( rgElements['emailauth'] ) rgElements['emailauth'].value = '';
	this.m_steamidEmailAuth = '';

	// part of the email auth modal
	$J('#authcode').value = '';

	if ( this.m_gidCaptcha )
		this.RefreshCaptcha();

	rgElements['username'].focus();
};

CLoginPromptManager.prototype.StartEmailAuthProcess = function()
{
	this.m_bInEmailAuthProcess = true;

	this.SetEmailAuthModalState( 'entercode' );

	var _this = this;
	this.m_EmailAuthModal = ShowDialog( 'Steam Guard', this.m_$ModalAuthCode.show() )
		.always( function() {
			$J(document.body).append( _this.m_$ModalAuthCode.hide() );
			_this.CancelEmailAuthProcess();
			_this.m_EmailAuthModal = null;
		} );

	this.m_EmailAuthModal.SetDismissOnBackgroundClick( false );
	this.m_EmailAuthModal.SetRemoveContentOnDismissal( false );
	$J('#authcode_entry').find('input').focus();
};

CLoginPromptManager.prototype.CancelEmailAuthProcess = function()
{
	this.m_steamidEmailAuth = '';
	if ( this.m_bInEmailAuthProcess )
	{
		this.m_bInEmailAuthProcess = false;

		// if the user closed the auth window on the last step, just redirect them like we normally would
		if ( this.m_bEmailAuthSuccessful )
			this.LoginComplete();
	}
};

CLoginPromptManager.prototype.TransferLogin = function( rgURLs, parameters )
{
	if ( this.m_bLoginTransferInProgress )
		return;
	this.m_bLoginTransferInProgress = true;

	var bOnCompleteFired = false;
	var _this = this;
	var fnOnComplete = function() {
		if ( !bOnCompleteFired )
			_this.OnTransferComplete();
		bOnCompleteFired = true;
	};

	var cResponsesExpected = rgURLs.length;
	$J(window).on( 'message', function() {
		if ( --cResponsesExpected == 0 )
			fnOnComplete();
	});

	for ( var i = 0 ; i < rgURLs.length; i++ )
	{
		var $IFrame = $J('<iframe>', {id: 'transfer_iframe' } ).hide();
		$J(document.body).append( $IFrame );

		var doc = $IFrame[0].contentWindow.document;
		doc.open();
		doc.write( '<form method="POST" action="' + rgURLs[i] + '" name="transfer_form">' );
		for ( var param in parameters )
		{
			doc.write( '<input type="hidden" name="' + param + '" value="' + V_EscapeHTML( parameters[param] ) + '">' );
		}
		doc.write( '</form>' );
		doc.write( '<script>window.onload = function(){ document.forms["transfer_form"].submit(); }</script>' );
		doc.close();
	}

	// after 10 seconds, give up on waiting for transfer
	window.setTimeout( fnOnComplete, 10000 );
};

CLoginPromptManager.prototype.OnTransferComplete = function()
{
	if ( !this.m_bLoginTransferInProgress )
		return;
	this.m_bLoginTransferInProgress = false;
	if ( !this.m_bInEmailAuthProcess && !this.m_bInTwoFactorAuthProcess )
		this.LoginComplete();
	else if ( this.m_bEmailAuthSuccessfulWantToLeave || this.m_bTwoFactorAuthSuccessfulWantToLeave)
		this.LoginComplete();
};

CLoginPromptManager.prototype.OnEmailAuthSuccessContinue = function()
{
		$J('#auth_buttonsets').children().hide();
	$J('#auth_buttonset_waiting').show();

	if ( this.m_bLoginTransferInProgress )
	{
		this.m_bEmailAuthSuccessfulWantToLeave = true;
	}
	else
		this.LoginComplete();
};

CLoginPromptManager.prototype.LoginComplete = function()
{
	if ( this.m_fnOnSuccess )
	{
		this.m_fnOnSuccess();
	}
	else if ( $J('#openidForm').length )
	{
				$J('#openidForm').submit();
	}
	else if ( this.m_strRedirectURL != '' )
	{
		window.location = this.m_strRedirectURL;
	}
	else if ( this.m_bIsMobile )
	{
				if ( document.forms['logon'].elements['oauth'] && ( document.forms['logon'].elements['oauth'].value.length > 0 ) )
		{
			window.location = this.m_sOAuthRedirectURI + '?' + document.forms['logon'].elements['oauth'].value;
		}
	}
};

CLoginPromptManager.prototype.SubmitAuthCode = function()
{
	if ( !v_trim( $J('#authcode').val() ).length )
		return;

	$J('#auth_details_computer_name').css('color', '85847f' );	//TODO
	$J('#auth_buttonsets').children().hide();
	$J('#auth_buttonset_waiting').show();

	this.$LogonFormElement( 'loginfriendlyname' ).val( $J('#friendlyname').val() );
	this.$LogonFormElement( 'emailauth' ).val( $J('#authcode').val() );

	this.DoLogin();
};

CLoginPromptManager.prototype.SetEmailAuthModalState = function( step )
{
	if ( step == 'submit' )
	{
		this.SubmitAuthCode();
		return;
	}
	else if ( step == 'complete' )
	{
		this.OnEmailAuthSuccessContinue();
		return;
	}

	$J('#auth_messages').children().hide();
	$J('#auth_message_' + step ).show();

	$J('#auth_details_messages').children().hide();
	$J('#auth_details_' + step ).show();

	$J('#auth_buttonsets').children().hide();
	$J('#auth_buttonset_' + step ).show();

	$J('#authcode_help_supportlink').hide();

	var icon='key';
	var bShowAuthcodeEntry = true;
	if ( step == 'entercode' )
	{
		icon = 'mail';
	}
	else if ( step == 'checkspam' )
	{
		icon = 'trash';
	}
	else if ( step == 'success' )
	{
		icon = 'unlock';
		bShowAuthcodeEntry = false;
		$J('#success_continue_btn').focus();
		this.m_EmailAuthModal.SetDismissOnBackgroundClick( true );
		this.m_EmailAuthModal.always( $J.proxy( this.LoginComplete, this ) );
	}
	else if ( step == 'incorrectcode' )
	{
		icon = 'lock';
	}
	else if ( step == 'help' )
	{
		icon = 'steam';
		bShowAuthcodeEntry = false;
		$J('#authcode_help_supportlink').show();
	}

	if ( bShowAuthcodeEntry )
	{
		var $AuthcodeEntry = $J('#authcode_entry');
		if ( !$AuthcodeEntry.is(':visible') )
		{
			$AuthcodeEntry.show().find('input').focus();
		}
		$J('#auth_details_computer_name').show();
	}
	else
	{
		$J('#authcode_entry').hide();
		$J('#auth_details_computer_name').hide();
	}

	$J('#auth_icon').attr('class', 'auth_icon auth_icon_' + icon );
};

CLoginPromptManager.prototype.StartTwoFactorAuthProcess = function()
{
	this.m_bInTwoFactorAuthProcess = true;
	this.SetTwoFactorAuthModalState( 'entercode' );

	var _this = this;
	this.m_TwoFactorModal = ShowDialog( 'Mobilní autentifikace funkce Steam Guard', this.m_$ModalTwoFactor.show() )
		.fail( function() { _this.CancelTwoFactorAuthProcess(); } )
		.always( function() {
			$J(document.body).append( _this.m_$ModalTwoFactor.hide() );
			_this.m_bInTwoFactorAuthProcess = false;
			_this.m_TwoFactorModal = null;
		} );

	this.m_TwoFactorModal.SetDismissOnBackgroundClick( false );
	this.m_TwoFactorModal.SetRemoveContentOnDismissal( false );

	$J('#twofactorcode_entry').focus();
};


CLoginPromptManager.prototype.CancelTwoFactorAuthProcess = function()
{
	this.m_bInTwoFactorAuthProcess = false;

	if ( this.m_bTwoFactorAuthSuccessful )
		this.LoginComplete();
	else
		this.ClearLoginForm();
};


CLoginPromptManager.prototype.OnTwoFactorResetOptionsResponse = function( results )
{
	if ( results.success && results.options.sms.allowed )
	{
		this.m_sPhoneNumberLastDigits = results.options.sms.last_digits;
		this.SetTwoFactorAuthModalState( 'selfhelp_sms_remove' ); // Or reset if this.m_bTwoFactorReset
	}
	else if ( results.success )
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_nosms' );
	}
	else
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_failure' );
		$J( '#login_twofactorauth_details_selfhelp_failure' ).text( results.message );
	}
};


CLoginPromptManager.prototype.OnTwoFactorRecoveryFailure = function()
{
	this.SetTwoFactorAuthModalState( 'selfhelp_failure' );
	$J( '#login_twofactorauth_details_selfhelp_failure' ).text( '' ); // v0v
};


CLoginPromptManager.prototype.OnStartRemoveTwoFactorResponse = function( results )
{
	if ( results.success )
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_sms_remove_entercode' );
	}
	else
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_failure' );
		$J( '#login_twofactorauth_details_selfhelp_failure' ).text( results.message );
	}
};


CLoginPromptManager.prototype.OnRemoveTwoFactorResponse = function( results )
{
	if ( results.success )
	{
		if ( this.m_bTwoFactorReset )
		{
			this.RunLocalURL( "steammobile://steamguard?op=setsecret&arg1=" + results.replacement_token );
			this.SetTwoFactorAuthModalState( 'selfhelp_twofactor_replaced' );
		}
		else
		{
			this.SetTwoFactorAuthModalState( 'selfhelp_twofactor_removed' );
		}
	}
	else if ( results.retry )
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_sms_remove_incorrectcode' );
	}
	else
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_failure' );
		$J( '#login_twofactorauth_details_selfhelp_failure' ).text( results.message );
	}
};


CLoginPromptManager.prototype.OnUseTwoFactorRecoveryCodeResponse = function( results )
{
	if ( results.success )
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_twofactor_removed' );
	}
	else if ( results.retry )
	{
		$J( '#login_twofactorauth_details_selfhelp_rcode_incorrectcode' ).text( results.message );
		this.SetTwoFactorAuthModalState( 'selfhelp_rcode_incorrectcode' );
	}
	else if ( results.exhausted )
	{
		$J( '#login_twofactorauth_details_selfhelp_rcode_incorrectcode_exhausted' ).text( results.message );
		this.SetTwoFactorAuthModalState( 'selfhelp_rcode_incorrectcode_exhausted' );
	}
	else
	{
		this.SetTwoFactorAuthModalState( 'selfhelp_failure' );
		$J( '#login_twofactorauth_details_selfhelp_failure' ).text( results.message );
	}
};


CLoginPromptManager.prototype.OnTwoFactorAuthSuccessContinue = function()
{
	if ( !this.m_bIsMobile )
	{
		$J('#login_twofactorauth_buttonsets').children().hide();
		$J('#login_twofactorauth_buttonset_waiting').show();
	}

	if ( this.m_bLoginTransferInProgress )
	{
		this.m_bTwoFactorAuthSuccessfulWantToLeave = true;
	}
	else
	{
		this.LoginComplete();
	}
};

CLoginPromptManager.prototype.SetTwoFactorAuthModalState = function( step )
{
	if ( step == 'submit' )
	{
		$J('#login_twofactor_authcode_entry').hide();
		this.SubmitTwoFactorCode();
		return;
	}
	else if ( step == 'success' )
	{
		this.OnTwoFactorAuthSuccessContinue();
		return;
	}

	$J('#login_twofactorauth_messages').children().hide();
	$J('#login_twofactorauth_message_' + step ).show();

	$J('#login_twofactorauth_details_messages').children().hide();
	$J('#login_twofactorauth_details_' + step ).show();

	$J('#login_twofactorauth_buttonsets').children().hide();
	$J('#login_twofactorauth_buttonset_' + step ).show();

	$J('#login_twofactor_authcode_help_supportlink').hide();

	var icon = 'key';
	if ( step == 'entercode' )
	{
		icon = 'phone';
		$J('#login_twofactor_authcode_entry').show();
		$J('#twofactorcode_entry').val('');
		$J('#login_twofactorauth_message_entercode_accountname').text( this.m_strUsernameEntered );
		$J('#twofactorcode_entry').focus();
	}
	else if ( step == 'incorrectcode' )
	{
		icon = 'lock';
		$J('#login_twofactor_authcode_entry').show();
		$J('#twofactorcode_entry').val('');
		$J('#twofactorcode_entry').focus();
	}
	else if ( step == 'selfhelp' )
	{
		icon = 'steam';
		$J('#login_twofactor_authcode_entry').hide();

		if ( !this.m_bIsMobileSteamClient
				|| this.BIsAndroid() && !this.BIsUserInMobileClientVersionOrNewer( 2, 0, 32 )
				|| this.BIsIos() && !this.BIsUserInMobileClientVersionOrNewer( 2, 0, 0 )
				// no version minimum for Windows phones
			)
		{
			$J( '#login_twofactorauth_buttonset_selfhelp div[data-modalstate=selfhelp_sms_reset_start]' ).hide();
		}
	}
	else if ( step == 'selfhelp_sms_remove_start' || step == 'selfhelp_sms_reset_start' )
	{
		icon = 'steam';
		$J('#login_twofactor_authcode_entry').hide();

		$J('#login_twofactorauth_messages').children().hide();
		$J('#login_twofactorauth_details_messages').children().hide();

		$J('#login_twofactorauth_buttonsets').children().hide();
		$J('#login_twofactorauth_buttonset_waiting').show();

		this.m_bTwoFactorReset = (step == 'selfhelp_sms_reset_start');

		$J.post( this.m_strBaseURL + 'getresetoptions/', this.GetParameters( {} ) )
				.done( $J.proxy( this.OnTwoFactorResetOptionsResponse, this ) )
				.fail( $J.proxy( this.OnTwoFactorRecoveryFailure, this ) );
	}
	else if ( step == 'selfhelp_sms_remove' )
	{
		icon = 'steam';
		$J('#login_twofactorauth_selfhelp_sms_remove_last_digits').text( this.m_sPhoneNumberLastDigits );
	}
	else if ( step == 'selfhelp_sms_remove_sendcode' )
	{
		icon = 'steam';
		$J('#login_twofactor_authcode_entry').hide();

		$J('#login_twofactorauth_messages').children().hide();
		$J('#login_twofactorauth_details_messages').children().hide();

		$J('#login_twofactorauth_buttonsets').children().hide();
		$J('#login_twofactorauth_buttonset_waiting').show();

		$J.post( this.m_strBaseURL + 'startremovetwofactor/', this.GetParameters( {} ) )
				.done( $J.proxy( this.OnStartRemoveTwoFactorResponse, this ) )
				.fail( $J.proxy( this.OnTwoFactorRecoveryFailure, this ) );
	}
	else if ( step == 'selfhelp_sms_remove_entercode' )
	{
		$J('#login_twofactorauth_selfhelp_sms_remove_entercode_last_digits').text( this.m_sPhoneNumberLastDigits );

		$J('#login_twofactor_authcode_entry').show();
		$J('#twofactorcode_entry').val('');
		$J('#twofactorcode_entry').focus();
	}
	else if ( step == 'selfhelp_sms_remove_checkcode' )
	{
		$J('#login_twofactor_authcode_entry').hide();

		$J('#login_twofactorauth_messages').children().hide();
		$J('#login_twofactorauth_details_messages').children().hide();

		$J('#login_twofactorauth_buttonsets').children().hide();
		$J('#login_twofactorauth_buttonset_waiting').show();

		// Immediately skip to incorrect code step without actually checking it if the user forgot to enter a code.
		if ( $J('#twofactorcode_entry').val().length == 0 )
		{
			this.SetTwoFactorAuthModalState( 'selfhelp_sms_remove_incorrectcode' );
		}
		else
		{
			var rgParameters = {
				smscode: $J( '#twofactorcode_entry' ).val(),
				reset: this.m_bTwoFactorReset ? 1 : 0
			};

			$J.post( this.m_strBaseURL + 'removetwofactor/', this.GetParameters( rgParameters ) )
					.done( $J.proxy( this.OnRemoveTwoFactorResponse, this ) )
					.fail( $J.proxy( this.OnTwoFactorRecoveryFailure, this ) );
		}
	}
	else if ( step == 'selfhelp_sms_remove_incorrectcode' )
	{
		icon = 'lock';
		$J('#login_twofactor_authcode_entry').show();
		$J('#twofactorcode_entry').focus();
	}
	else if ( step == 'selfhelp_twofactor_removed' )
	{
		icon = 'unlock';
		$J('#twofactorcode_entry').val(''); // Make sure the next login doesn't supply a code
	}
	else if ( step == 'selfhelp_twofactor_replaced' )
	{
		icon = 'steam';
		$J('#twofactorcode_entry').val('');
	}
	else if ( step == 'selfhelp_sms_remove_complete' )
	{
		this.m_TwoFactorModal.Dismiss();
		this.m_bInTwoFactorAuthProcess = false;
		this.DoLogin();
	}
	else if ( step == 'selfhelp_nosms' )
	{
		icon = 'steam';
		$J('#login_twofactor_authcode_entry').hide();
	}
	else if ( step == 'selfhelp_rcode' )
	{
		$J('#login_twofactor_authcode_entry').show();
		$J('#twofactorcode_entry').val('');
		$J('#twofactorcode_entry').focus();
	}
	else if ( step == 'selfhelp_rcode_checkcode' )
	{
		$J('#login_twofactor_authcode_entry').hide();

		$J('#login_twofactorauth_messages').children().hide();
		$J('#login_twofactorauth_details_messages').children().hide();

		$J('#login_twofactorauth_buttonsets').children().hide();
		$J('#login_twofactorauth_buttonset_waiting').show();

		// Immediately skip to incorrect code step without actually checking it if the user forgot to enter a code.
		if ( $J('#twofactorcode_entry').val().length == 0 )
		{
			this.SetTwoFactorAuthModalState( 'selfhelp_rcode_incorrectcode' );
		}
		else
		{
			var rgParameters = { rcode: $J( '#twofactorcode_entry' ).val() };

			$J.post( this.m_strBaseURL + 'userecoverycode/', this.GetParameters( rgParameters ) )
					.done( $J.proxy( this.OnUseTwoFactorRecoveryCodeResponse, this ) )
					.fail( $J.proxy( this.OnTwoFactorRecoveryFailure, this ) );
		}
	}
	else if ( step == 'selfhelp_rcode_incorrectcode' )
	{
		icon = 'lock';
		$J('#login_twofactor_authcode_entry').show();
		$J('#twofactorcode_entry').focus();
	}
	else if ( step == 'selfhelp_couldnthelp' )
	{
		icon = 'steam';
		$J('#login_twofactor_authcode_entry').hide();
	}
	else if ( step == 'help' )
	{
		icon = 'steam';
		$J('#login_twofactor_authcode_entry').hide();
		$J('#login_twofactor_authcode_help_supportlink').show();
	}
	else if ( step == 'selfhelp_failure' )
	{
		icon = 'steam';
	}

	if ( this.m_bInTwoFactorAuthProcess && this.m_TwoFactorModal )
	{
		this.m_TwoFactorModal.AdjustSizing();
	}

	$J('#login_twofactorauth_icon').attr( 'class', 'auth_icon auth_icon_' + icon );
};

CLoginPromptManager.prototype.SubmitTwoFactorCode = function()
{
	this.m_sAuthCode = $J('#twofactorcode_entry').val();


	$J('#login_twofactorauth_messages').children().hide();
	$J('#login_twofactorauth_details_messages').children().hide();

	$J('#login_twofactorauth_buttonsets').children().hide();
	$J('#login_twofactorauth_buttonset_waiting').show();

	this.DoLogin();
};

CLoginPromptManager.sm_$Modals = null;	// static
CLoginPromptManager.prototype.InitModalContent = function()
{
	
	var $modals = $J('#loginModals');
	if ( $modals.length == 0 )
	{
		// This does not work on Android 2.3, nor does creating the DOM node and
		// setting innerHTML without jQuery. So on the mobile login page, we put
		// the modals into the page directly, but not all pages have that.
		CLoginPromptManager.sm_$Modals = $J( "<div id=\"loginModals\">\r\n\t<div class=\"login_modal loginAuthCodeModal\" style=\"display: none\">\r\n\t\t<form data-ajax=\"false\">\r\n\t\t\t<div class=\"auth_message_area\">\r\n\t\t\t\t<div id=\"auth_icon\" class=\"auth_icon auth_icon_key\">\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_messages\" id=\"auth_messages\">\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">V\u00e1\u017een\u00fd u\u017eivateli,<\/div>\r\n\t\t\t\t\t\t<p>Zd\u00e1 se, \u017ee jste se p\u0159ihl\u00e1sili do slu\u017eby Steam z nov\u00e9ho prohl\u00ed\u017ee\u010de nebo po\u010d\u00edta\u010de. Nebo jste se mo\u017en\u00e1 jen dlouho neuk\u00e1zali...<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_checkspam\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">Neskon\u010dila ve spamu?<\/div>\r\n\t\t\t\t\t\t<p>Zkontrolovali jste svou slo\u017eku se spamem? Pokud v p\u0159\u00edchoz\u00edch zpr\u00e1v\u00e1ch nevid\u00edte \u017e\u00e1dnou novou zpr\u00e1vu od podpory slu\u017eby Steam, zkuste se pod\u00edvat do t\u00e9to slo\u017eky.<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_success\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">Povedlo se!<\/div>\r\n\t\t\t\t\t\t<p>Nyn\u00ed m\u016f\u017eete pou\u017e\u00edvat sv\u016fj \u00fa\u010det slu\u017eby Steam i zde.<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">Jejda!<\/div>\r\n\t\t\t\t\t\t<p>Je n\u00e1m l\u00edto, <br> ale zadan\u00fd k\u00f3d nesouhlas\u00ed...<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_help\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">R\u00e1di V\u00e1m pom\u016f\u017eeme!<\/div>\r\n\t\t\t\t\t\t<p>Je n\u00e1m l\u00edto, \u017ee se pot\u00fdk\u00e1te s probl\u00e9my. Ch\u00e1peme, jak je pro V\u00e1s \u00fa\u010det slu\u017eby Steam d\u016fle\u017eit\u00fd, a ud\u011bl\u00e1me v\u0161e pro to, aby p\u0159\u00edstup k n\u011bmu z\u016fstal ve spr\u00e1vn\u00fdch rukou.<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div id=\"auth_details_messages\" class=\"auth_details_messages\">\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_entercode\" style=\"display: none;\">\r\n\t\t\t\t\tV r\u00e1mci vylep\u0161en\u00e9ho zabezpe\u010den\u00ed Va\u0161eho \u00fa\u010dtu budete muset tomuto prohl\u00ed\u017ee\u010di povolit p\u0159\u00edstup zad\u00e1n\u00edm k\u00f3du, kter\u00fd jsme V\u00e1m pr\u00e1v\u011b poslali na Va\u0161i e-mailovou adresu na <span id=\"emailauth_entercode_emaildomain\"><\/span>.\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_success\" style=\"display: none;\">\r\n\t\t\t\t\tPokud je tento po\u010d\u00edta\u010d ve\u0159ejn\u011b p\u0159\u00edstupn\u00fd, nezapome\u0148te se p\u0159ed odchodem odhl\u00e1sit.\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_help\" style=\"display: none;\">\r\n\t\t\t\t\tKontaktujte pros\u00edm podporu slu\u017eby Steam, kde V\u00e1m pom\u016f\u017ee vy\u0161kolen\u00fd zam\u011bstnanec. Pom\u00e1hat u\u017eivatel\u016fm s p\u0159\u00edstupem k jejich \u00fa\u010dtu je na\u0161\u00ed prioritou \u010d\u00edslo jedna.\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"authcode_entry_area\">\r\n\t\t\t\t<div id=\"authcode_entry\">\r\n\t\t\t\t\t<div class=\"authcode_entry_box\">\r\n\t\t\t\t\t\t<input class=\"authcode_entry_input authcode_placeholder\" id=\"authcode\" type=\"text\" value=\"\"\r\n\t\t\t\t\t\t\t   placeholder=\"zde zadejte sv\u016fj k\u00f3d\">\r\n\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div id=\"authcode_help_supportlink\">\r\n\t\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=4020-ALZM-5519\" data-ajax=\"false\" data-externallink=\"1\">Pro pomoc s p\u0159\u00edstupem k \u00fa\u010dtu kontaktujte podporu slu\u017eby Steam<\/a>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"modal_buttons\" id=\"auth_buttonsets\">\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Potvrdit<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">m\u016fj speci\u00e1ln\u00ed p\u0159\u00edstupov\u00fd k\u00f3d<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"checkspam\" class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Nic mi nep\u0159i\u0161lo...<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Nikde ani stopa po e-mailu od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_checkspam\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">M\u00e1m ho!<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">a do pol\u00ed\u010dka v\u00fd\u0161e jsem zadal p\u0159\u00edstupov\u00fd k\u00f3d<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"help\"  class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Po\u0159\u00e1d nic nep\u0159i\u0161lo...<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Nikde ani stopa po zpr\u00e1v\u011b od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_success\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_button auth_button_spacer\">\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<a data-modalstate=\"complete\" class=\"auth_button\" id=\"success_continue_btn\" href=\"javascript:void(0);\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Pokra\u010dovat!<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">&nbsp;<br>&nbsp;<\/div>\r\n\t\t\t\t\t<\/a>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Chci to zkusit znova<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">a do pol\u00ed\u010dka v\u00fd\u0161e jsem zadal p\u0159\u00edstupov\u00fd k\u00f3d<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"help\" class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Pot\u0159ebuji pomoc<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Asi budu pot\u0159ebovat pomoc od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_waiting\" style=\"display: none;\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div style=\"\" id=\"auth_details_computer_name\" class=\"auth_details_messages\">\r\n\t\t\t\tPro snadn\u00e9 rozpozn\u00e1n\u00ed tohoto prohl\u00ed\u017ee\u010de v seznamu za\u0159\u00edzen\u00ed, kter\u00e1 jsou povolena funkc\u00ed Steam Guard, dejte prohl\u00ed\u017ee\u010di popisn\u00fd n\u00e1zev (alespo\u0148 o 6 znac\u00edch).\t\t\t\t<div id=\"friendly_name_box\" class=\"friendly_name_box\">\r\n\t\t\t\t\t<input class=\"authcode_entry_input authcode_placeholder\" id=\"friendlyname\" type=\"text\"\r\n\t\t\t\t\t\t   placeholder=\"zadejte popisn\u00fd n\u00e1zev\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div style=\"display: none;\">\r\n\t\t\t\t<input type=\"submit\">\r\n\t\t\t<\/div>\r\n\t\t<\/form>\r\n\t<\/div>\r\n\r\n\t<div class=\"login_modal loginIPTModal\" style=\"display: none\">\r\n\t\t<div class=\"auth_message_area\">\r\n\t\t\t<div class=\"auth_icon ipt_icon\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_messages\">\r\n\t\t\t\t<div class=\"auth_message\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Omlouv\u00e1me se<\/div>\r\n\t\t\t\t\t<p>Z tohoto po\u010d\u00edta\u010de nen\u00ed mo\u017en\u00fd p\u0159\u00edstup k va\u0161emu \u00fa\u010dtu bez dal\u0161\u00edho ov\u011b\u0159en\u00ed.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"auth_details_messages\">\r\n\t\t\t<div class=\"auth_details\">\r\n\t\t\t\tJestli\u017ee pot\u0159ebujete pomoc od na\u0161ich zam\u011bstnanc\u016f, kontaktujte pros\u00edm podporu slu\u017eby Steam. Pom\u00e1hat u\u017eivatel\u016fm s p\u0159\u00edstupem k \u00fa\u010dtu je na\u0161\u00ed prioritou \u010d\u00edslo jedna.\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"authcode_entry_area\">\r\n\t\t<\/div>\r\n\t\t<div class=\"modal_buttons\">\r\n\t\t\t<div class=\"auth_buttonset\" >\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=9400-IPAX-9398&auth=e39b5c227cffc8ae65414aba013e5fef\" class=\"auth_button leftbtn\" data-ajax=\"false\" data-externallink=\"1\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">V\u00edce informac\u00ed...<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">o technologii Intel&reg; Identity Protection<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\" class=\"auth_button\" data-ajax=\"false\" data-externallink=\"1\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pot\u0159ebuji pomoc<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Asi budu pot\u0159ebovat pomoc od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t<\/div>\r\n\r\n\r\n\r\n\t<div class=\"login_modal loginTwoFactorCodeModal\" style=\"display: none\">\r\n\t\t<form>\r\n\t\t<div class=\"twofactorauth_message_area\">\r\n\t\t\t<div id=\"login_twofactorauth_icon\" class=\"auth_icon auth_icon_key\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_messages\" id=\"login_twofactorauth_messages\">\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Dobr\u00fd den, u\u017eivateli <span id=\"login_twofactorauth_message_entercode_accountname\"><\/span>!<\/div>\r\n\t\t\t\t\t<p>Tento \u00fa\u010det moment\u00e1ln\u011b pou\u017e\u00edv\u00e1 mobiln\u00ed autentifik\u00e1tor funkce Steam Guard.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Jejda!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, <br>ale zadan\u00fd k\u00f3d nesouhlas\u00ed...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">R\u00e1di V\u00e1m pom\u016f\u017eeme!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, \u017ee se pot\u00fdk\u00e1te s probl\u00e9my. Ch\u00e1peme, jak je pro V\u00e1s \u00fa\u010det slu\u017eby Steam d\u016fle\u017eit\u00fd, a ud\u011bl\u00e1me v\u0161e pro to, aby p\u0159\u00edstup k n\u011bmu z\u016fstal ve spr\u00e1vn\u00fdch rukou.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Potvr\u010fte vlastnictv\u00ed tohoto \u00fa\u010dtu<\/div>\r\n\t\t\t\t\t<p>Na Va\u0161e telefonn\u00ed telefonn\u00ed \u010d\u00edslo kon\u010d\u00edc\u00ed <span id=\"login_twofactorauth_selfhelp_sms_remove_last_digits\"><\/span> ode\u0161leme SMS zpr\u00e1vu obsahuj\u00edc\u00ed obnovovac\u00ed k\u00f3d pro obnoven\u00ed Va\u0161eho \u00fa\u010dtu. Jakmile jej zad\u00e1te, odebereme mobiln\u00ed autentifik\u00e1tor z tohoto \u00fa\u010dtu a dal\u0161\u00ed k\u00f3dy funkce Steam Guard V\u00e1m budou zas\u00edl\u00e1ny e-mailem.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Potvr\u010fte vlastnictv\u00ed tohoto \u00fa\u010dtu<\/div>\r\n\t\t\t\t\t<p>Na Va\u0161e telefonn\u00ed telefonn\u00ed \u010d\u00edslo kon\u010d\u00edc\u00ed <span id=\"login_twofactorauth_selfhelp_sms_remove_entercode_last_digits\"><\/span> jsme odeslali SMS zpr\u00e1vu obsahuj\u00edc\u00ed potvrzovac\u00ed k\u00f3d. Zadejte jej n\u00ed\u017ee, abychom mohli odebrat mobiln\u00ed autentifik\u00e1tor z Va\u0161eho \u00fa\u010dtu.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Jejda!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, <br>ale zadan\u00fd k\u00f3d nesouhlas\u00ed...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_twofactor_removed\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Povedlo se!<\/div>\r\n\t\t\t\t\t<p>Odebrali jsme mobiln\u00ed autentifik\u00e1tor z Va\u0161eho \u00fa\u010dtu. A\u017e se p\u0159\u00ed\u0161t\u011b p\u0159ihl\u00e1s\u00edte, budete muset zadat k\u00f3d funkce Steam Guard, kter\u00fd V\u00e1m bude zasl\u00e1n na Va\u0161i e-mailovou adresu.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_twofactor_replaced\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Povedlo se!<\/div>\r\n\t\t\t\t\t<p>Nyn\u00ed m\u016f\u017eete pomoc\u00ed tohoto za\u0159\u00edzen\u00ed z\u00edskat autentifika\u010dn\u00ed k\u00f3dy pro sv\u016fj \u00fa\u010det. Jak\u00e9koli za\u0159\u00edzen\u00ed, kter\u00e9 jste d\u0159\u00edve pou\u017e\u00edvali pro z\u00edsk\u00e1v\u00e1n\u00ed autentifika\u010dn\u00edch k\u00f3d\u016f, ji\u017e nebude fungovat.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_nosms\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Pamatujete si obnovovac\u00ed k\u00f3d?<\/div>\r\n\t\t\t\t\t<p>Jeliko\u017e nem\u00e1te ke sv\u00e9mu \u00fa\u010dtu slu\u017eby Steam p\u0159i\u0159azen\u00e9 telefonn\u00ed \u010d\u00edslo, nem\u016f\u017eeme pomoc\u00ed SMS zpr\u00e1vy ov\u011b\u0159it, zda jste skute\u010dn\u011b jeho vlastn\u00edkem. Pamatujete si obnovovac\u00ed k\u00f3d, kter\u00fd jste obdr\u017eeli p\u0159i p\u0159id\u00e1v\u00e1n\u00ed mobiln\u00edho autentifik\u00e1toru k Va\u0161emu \u00fa\u010dtu? Obnovovac\u00ed k\u00f3d za\u010d\u00edn\u00e1 p\u00edsmenem \u201eR\u201c.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Zadejte obnovovac\u00ed k\u00f3d<\/div>\r\n\t\t\t\t\t<p>Do pol\u00ed\u010dka n\u00ed\u017ee pros\u00edm zadejte sv\u016fj obnovovac\u00ed k\u00f3d. Z\u00e1lo\u017en\u00ed k\u00f3d za\u010d\u00edn\u00e1 p\u00edsmenem \u201eR\u201c.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Jejda!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, <br>ale zadan\u00fd k\u00f3d nesouhlas\u00ed...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Jejda!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, <br>ale zadan\u00fd k\u00f3d nesouhlas\u00ed...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_message\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Jejda!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, <br>ale zadan\u00fd k\u00f3d nesouhlas\u00ed...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_couldnthelp\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">R\u00e1di V\u00e1m pom\u016f\u017eeme!<\/div>\r\n\t\t\t\t\t<p>Pokud ji\u017e nem\u00e1te p\u0159\u00edstup k telefonn\u00edmu \u010d\u00edslu p\u0159i\u0159azen\u00e9mu k tomuto \u00fa\u010dtu a nepamatujete si obnovovac\u00ed k\u00f3d, kter\u00fd jste obdr\u017eeli p\u0159i p\u0159id\u00e1v\u00e1n\u00ed mobiln\u00edho autentifik\u00e1toru k Va\u0161emu \u00fa\u010dtu, kontaktujte pros\u00edm pro pomoc s navr\u00e1cen\u00edm \u00fa\u010dtu podporu slu\u017eby Steam.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_help\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">R\u00e1di V\u00e1m pom\u016f\u017eeme!<\/div>\r\n\t\t\t\t\t<p>Je n\u00e1m l\u00edto, \u017ee se pot\u00fdk\u00e1te s probl\u00e9my. Ch\u00e1peme, jak je pro V\u00e1s \u00fa\u010det slu\u017eby Steam d\u016fle\u017eit\u00fd, a ud\u011bl\u00e1me v\u0161e pro to, aby p\u0159\u00edstup k n\u011bmu z\u016fstal ve spr\u00e1vn\u00fdch rukou.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_failure\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">Omlouv\u00e1me se!<\/div>\r\n\t\t\t\t\t<p>P\u0159i zpracov\u00e1v\u00e1n\u00ed Va\u0161eho po\u017eadavku do\u0161lo k chyb\u011b.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div id=\"login_twofactorauth_details_messages\" class=\"twofactorauth_details_messages\">\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_entercode\" style=\"display: none;\">\r\n\t\t\t\tZadejte aktu\u00e1ln\u00ed k\u00f3d ze svoj\u00ed mobiln\u00ed aplikace slu\u017eby Steam:\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp\" style=\"display: none;\">\r\n\t\t\t\tPokud jste p\u0159i\u0161li o svoje mobiln\u00ed za\u0159\u00edzen\u00ed nebo odinstalovali aplikaci Steam a nem\u016f\u017eete obdr\u017eet dal\u0161\u00ed k\u00f3dy, m\u016f\u017eete ze sv\u00e9ho \u00fa\u010dtu odebrat mobiln\u00ed autentifik\u00e1tor. T\u00edm v\u0161ak sn\u00ed\u017e\u00edte zabezpe\u010den\u00ed sv\u00e9ho \u00fa\u010dtu, tak\u017ee doporu\u010dujeme p\u0159idat mobiln\u00ed autentifik\u00e1tor k dal\u0161\u00edmu za\u0159\u00edzen\u00ed hned, jak to bude mo\u017en\u00e9.\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_help\" style=\"display: none;\">\r\n\t\t\t\tKontaktujte pros\u00edm podporu slu\u017eby Steam, kde V\u00e1m pom\u016f\u017ee vy\u0161kolen\u00fd zam\u011bstnanec.\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_failure\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"twofactorauthcode_entry_area\">\r\n\t\t\t<div id=\"login_twofactor_authcode_entry\">\r\n\t\t\t\t<div class=\"twofactorauthcode_entry_box\">\r\n\t\t\t\t\t<input class=\"twofactorauthcode_entry_input authcode_placeholder\" id=\"twofactorcode_entry\" type=\"text\"\r\n\t\t\t\t\t\t   placeholder=\"zde zadejte sv\u016fj k\u00f3d\" autocomplete=\"off\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div id=\"login_twofactor_authcode_help_supportlink\">\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=4020-ALZM-5519\">\r\n\t\t\t\t\tPro pomoc s p\u0159\u00edstupem k \u00fa\u010dtu kontaktujte podporu slu\u017eby Steam\t\t\t\t<\/a>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"modal_buttons\" id=\"login_twofactorauth_buttonsets\">\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_entercode\" style=\"display: none;\">\r\n\t\t\t\t<div type=\"submit\" class=\"auth_button leftbtn\" data-modalstate=\"submit\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Odeslat<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">m\u016fj autentifika\u010dn\u00ed k\u00f3d<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pot\u0159ebuji pomoc<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Ji\u017e nem\u00e1m p\u0159\u00edstup ke sv\u00fdm k\u00f3d\u016fm mobiln\u00edho autentifik\u00e1toru<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"submit\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Chci to zkusit znova<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">a do pol\u00ed\u010dka v\u00fd\u0161e jsem zadal autentifika\u010dn\u00ed k\u00f3d<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pot\u0159ebuji pomoc<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Asi budu pot\u0159ebovat pomoc od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_start\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\" style=\"font-size: 16px;\">Odebrat autentifik\u00e1tor<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">a nechat si k\u00f3dy zas\u00edlat p\u0159es e-mail<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_sms_reset_start\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pou\u017e\u00edt toto za\u0159\u00edzen\u00ed<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">a nechat si k\u00f3dy zas\u00edlat pomoc\u00ed t\u00e9to aplikace<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_sendcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">OK!<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Po\u0161lete mi SMS zpr\u00e1vu<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Nemohu,<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">proto\u017ee ji\u017e nem\u00e1m p\u0159\u00edstup k tomuto telefonn\u00edmu \u010d\u00edslu<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove_entercode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Odeslat<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Zadal jsem k\u00f3d v\u00fd\u0161e<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pomozte pros\u00edm<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Nep\u0159i\u0161la mi SMS zpr\u00e1va<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Odeslat<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Zadal jsem k\u00f3d. Zkus\u00edme to znovu.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pomozte pros\u00edm<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Nep\u0159i\u0161la mi SMS zpr\u00e1va<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_twofactor_removed\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_complete\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">P\u0159ihl\u00e1sit se<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">bez mobiln\u00edho autentifik\u00e1toru<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_twofactor_replaced\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_complete\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">P\u0159ihl\u00e1sit se<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">do mobiln\u00ed aplikace slu\u017eby Steam<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_nosms\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Ano<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">pamatuji si obnovovac\u00ed k\u00f3d, kter\u00fd za\u010d\u00edn\u00e1 p\u00edsmenem \u201eR\u201c<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Ne<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u017e\u00e1dn\u00fd takov\u00fd k\u00f3d si nepamatuji<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Odeslat<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">m\u016fj obnovovac\u00ed k\u00f3d<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pomozte pros\u00edm<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Asi budu pot\u0159ebovat pomoc od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Odeslat<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Zadal jsem k\u00f3d. Zkus\u00edme to znovu.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pomozte pros\u00edm<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Asi budu pot\u0159ebovat pomoc od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Pomozte pros\u00edm<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Asi budu pot\u0159ebovat pomoc od podpory slu\u017eby Steam...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_couldnthelp\" style=\"display: none;\">\r\n\t\t\t\t<a class=\"auth_button leftbtn\" href=\"https:\/\/help.steampowered.com\/\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Kontaktujte n\u00e1s<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">a my V\u00e1m pom\u016f\u017eeme s p\u0159\u00edstupem k \u00fa\u010dtu<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_waiting\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div style=\"display: none;\">\r\n\t\t\t<input type=\"submit\">\r\n\t\t<\/div>\r\n\t\t<\/form>\r\n\t<\/div>\r\n<\/div>\r\n" );
		$J('body').append( CLoginPromptManager.sm_$Modals );
	}
	else
	{
		CLoginPromptManager.sm_$Modals = $modals;
	}
};

CLoginPromptManager.prototype.GetModalContent = function( strModalType )
{
	var $ModalContent = CLoginPromptManager.sm_$Modals.find( '.login_modal.' + strModalType );

	if ( this.m_bIsMobileSteamClient )
	{
		$ModalContent.find('a[data-externallink]' ).each( function() {
			$J(this).attr( 'href', 'steammobile://openexternalurl?url=' + $J(this).attr('href') );
		});
	}

	return $ModalContent;
};

