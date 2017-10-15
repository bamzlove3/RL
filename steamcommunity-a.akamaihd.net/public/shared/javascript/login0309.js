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
			ShowAlertDialog( '오류', 'Steam 서버와 연결하는 데 문제가 있습니다. 나중에 다시 시도해 주세요.' );
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
			ShowDialog( 'Intel® 개인정보 보호 기술', this.m_$ModalIPT.show() ).always( $J.proxy( this.ClearLoginForm, this ) );
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
	this.m_TwoFactorModal = ShowDialog( 'Steam Guard 모바일 인증', this.m_$ModalTwoFactor.show() )
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
		CLoginPromptManager.sm_$Modals = $J( "<div id=\"loginModals\">\r\n\t<div class=\"login_modal loginAuthCodeModal\" style=\"display: none\">\r\n\t\t<form data-ajax=\"false\">\r\n\t\t\t<div class=\"auth_message_area\">\r\n\t\t\t\t<div id=\"auth_icon\" class=\"auth_icon auth_icon_key\">\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_messages\" id=\"auth_messages\">\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\uc548\ub155\ud558\uc138\uc694!<\/div>\r\n\t\t\t\t\t\t<p>\uc0c8 \ube0c\ub77c\uc6b0\uc800 \ub610\ub294 \uc0c8 \ucef4\ud4e8\ud130\uc5d0\uc11c Steam\uc5d0 \ub85c\uadf8\uc778\ud558\ub824 \ud558\uc2dc\ub294 \uac83 \uac19\uad70\uc694. \uc544\ub2c8\uba74 \uc624\ub79c\ub9cc\uc5d0 \uc811\uc18d\ud558\uc168\uac70\ub098...<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_checkspam\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\uc2a4\ud338\ud568\uc5d0 \uc788\uc9c0 \uc54a\uc744\uae4c\uc694?<\/div>\r\n\t\t\t\t\t\t<p>\uc2a4\ud338 \uba54\uc77c\ud568\uc744 \ud655\uc778\ud574 \ubcf4\uc168\uc2b5\ub2c8\uae4c? \ubc1b\uc740 \uba54\uc77c\ud568\uc5d0 Steam \uace0\uac1d\uc9c0\uc6d0\uc5d0\uc11c \ubcf4\ub0b8 \uba54\uc77c\uc774 \uc5c6\ub2e4\uba74 \uc2a4\ud338 \uba54\uc77c\ud568\uc744 \ud655\uc778\ud574 \ubcf4\uc2ed\uc2dc\uc624.<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_success\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\uc131\uacf5!<\/div>\r\n\t\t\t\t\t\t<p>\uc774\uc81c \uc774 \ube0c\ub77c\uc6b0\uc800 \ub610\ub294 \uc774 \ucef4\ud4e8\ud130\uc5d0\uc11c \uadc0\ud558\uc758 Steam \uacc4\uc815\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\uc624, \uc774\ub7f0!<\/div>\r\n\t\t\t\t\t\t<p>\uc8c4\uc1a1\ud558\uc9c0\ub9cc, <br>\uc785\ub825\ud558\uc2e0 \ucf54\ub4dc\uac00 \ud2c0\ub9b0 \uac83 \uac19\ub124\uc694...<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_help\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\ub3c4\uc640\ub4dc\ub9b4\uac8c\uc694!<\/div>\r\n\t\t\t\t\t\t<p>\ubb38\uc81c\ub97c \uacaa\uac8c \ud574 \ub4dc\ub824 \uc8c4\uc1a1\ud569\ub2c8\ub2e4. Steam \uacc4\uc815\uc5d0 \uc811\uc18d\uc774 \ubd88\uac00\ub2a5\ud558\uc2ec\uc744 \ud655\uc778\ud558\uc600\uc73c\uba70, \ub3c4\uc6c0\uc744 \ub4dc\ub9ac\ub824 \ub178\ub825\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div id=\"auth_details_messages\" class=\"auth_details_messages\">\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t\ucd94\uac00\uc801\uc778 \ubcf4\uc548 \uc808\ucc28\ub85c\uc11c, \uadc0\ud558\uc758 \uba54\uc77c \uc8fc\uc18c( <span id=\"emailauth_entercode_emaildomain\"><\/span> )\ub85c \ubc1c\uc1a1\ub41c \ucf54\ub4dc\ub97c \uc785\ub825\ud574 \uc774 \ube0c\ub77c\uc6b0\uc800\ub85c\ubd80\ud130\uc758 \uc811\uadfc\uc744 \ud5c8\uac00\ud574 \uc8fc\uc138\uc694.\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_success\" style=\"display: none;\">\r\n\t\t\t\t\t\uacf5\uc6a9 \ucef4\ud4e8\ud130\ub77c\uba74 \ube0c\ub77c\uc6b0\uc800\ub97c \uc885\ub8cc\ud560 \ub54c Steam\uc5d0\uc11c \uaf2d \ub85c\uadf8\uc544\uc6c3 \ud574\uc8fc\uc138\uc694.\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_help\" style=\"display: none;\">\r\n\t\t\t\t\tSteam \uace0\uac1d\uc9c0\uc6d0\uc5d0 \ubb38\uc758\ud558\uc154\uc11c \uc800\ud76c \uc9c1\uc6d0\uc758 \ub3c4\uc6c0\uc744 \ubc1b\uc73c\uc2ed\uc2dc\uc624. \uadc0\ud558\uc758 \uacc4\uc815 \uc811\uadfc\uacfc \uad00\ub828\ub41c \uc815\ub2f9\ud55c \uc694\uccad\uc740 \uc800\ud76c\uac00 \uac00\uc7a5 \uc911\uc694\ud558\uac8c \ub2e4\ub8e8\ub294 \uc0ac\uc548\uc785\ub2c8\ub2e4.\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"authcode_entry_area\">\r\n\t\t\t\t<div id=\"authcode_entry\">\r\n\t\t\t\t\t<div class=\"authcode_entry_box\">\r\n\t\t\t\t\t\t<input class=\"authcode_entry_input authcode_placeholder\" id=\"authcode\" type=\"text\" value=\"\"\r\n\t\t\t\t\t\t\t   placeholder=\"\uc5ec\uae30\uc5d0 \ucf54\ub4dc\ub97c \uc785\ub825\ud574\uc8fc\uc138\uc694\">\r\n\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div id=\"authcode_help_supportlink\">\r\n\t\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=4020-ALZM-5519\" data-ajax=\"false\" data-externallink=\"1\">\uacc4\uc815 \uc811\uadfc\uacfc \uad00\ub828\ud558\uc5ec Steam \uace0\uac1d \uc9c0\uc6d0\uc5d0 \uc9c0\uc6d0 \uc694\uccad\ud558\uae30<\/a>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"modal_buttons\" id=\"auth_buttonsets\">\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\uc81c\ucd9c<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\uc2b9\uc778 \ucf54\ub4dc<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"checkspam\" class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\ubb34\uc2a8 \uba54\uc77c\uc774\uc694?<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uace0\uac1d\uc9c0\uc6d0\uc5d0\uc11c \uc544\ubb34\ub7f0 \uba54\uc77c\ub3c4 \ubc1b\uc9c0 \ubabb\ud588\ub294\ub370\uc694...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_checkspam\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\ucc3e\uc558\uc2b5\ub2c8\ub2e4!<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8\ub9ac\uace0 \uc704\uc5d0 \uc2b9\uc778 \ucf54\ub4dc\ub97c \uc785\ub825\ud588\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"help\"  class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\uc5ec\uc804\ud788 \uc548 \ubcf4\uc5ec\uc694...<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uace0\uac1d\uc9c0\uc6d0\uc5d0\uc11c \uc544\ubb34\ub7f0 \uba54\uc77c\ub3c4 \ubc1b\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_success\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_button auth_button_spacer\">\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<a data-modalstate=\"complete\" class=\"auth_button\" id=\"success_continue_btn\" href=\"javascript:void(0);\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Steam\uc73c\ub85c!<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">&nbsp;<br>&nbsp;<\/div>\r\n\t\t\t\t\t<\/a>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\ub2e4\uc2dc \ud574 \ubcfc\uac8c\uc694<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8\ub9ac\uace0 \uc704\uc5d0 \uc2b9\uc778 \ucf54\ub4dc\ub97c \ub2e4\uc2dc \uc785\ub825\ud588\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"help\" class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc640\uc8fc\uc138\uc694<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uace0\uac1d\uc9c0\uc6d0\uc758 \ub3c4\uc6c0\uc774 \ud544\uc694\ud560 \uac83 \uac19\uc2b5\ub2c8\ub2e4...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_waiting\" style=\"display: none;\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div style=\"\" id=\"auth_details_computer_name\" class=\"auth_details_messages\">\r\n\t\t\t\tSteam Guard\uac00 \ud65c\uc131\ud654\ub41c \uae30\uae30 \ubaa9\ub85d\uc5d0\uc11c \uc9c0\uae08 \uc811\uc18d\ud558\uc2e0 \ube0c\ub77c\uc6b0\uc800\ub97c \uae08\ubc29 \uc54c\uc544\ubcfc \uc218 \uc788\ub3c4\ub85d, \uc774 \ube0c\ub77c\uc6b0\uc800\uc758 \uc774\ub984\uc774\ub098 \uc560\uce6d\uc744 \uc785\ub825\ud558\uc138\uc694. \ucd5c\uc18c 6\uc790 \uc774\uc0c1\uc774\uc5b4\uc57c \ud569\ub2c8\ub2e4.\t\t\t\t<div id=\"friendly_name_box\" class=\"friendly_name_box\">\r\n\t\t\t\t\t<input class=\"authcode_entry_input authcode_placeholder\" id=\"friendlyname\" type=\"text\"\r\n\t\t\t\t\t\t   placeholder=\"\uc774\ub984\uc774\ub098 \uc560\uce6d\uc744 \uc785\ub825\ud558\uc138\uc694\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div style=\"display: none;\">\r\n\t\t\t\t<input type=\"submit\">\r\n\t\t\t<\/div>\r\n\t\t<\/form>\r\n\t<\/div>\r\n\r\n\t<div class=\"login_modal loginIPTModal\" style=\"display: none\">\r\n\t\t<div class=\"auth_message_area\">\r\n\t\t\t<div class=\"auth_icon ipt_icon\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_messages\">\r\n\t\t\t\t<div class=\"auth_message\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc8c4\uc1a1\ud569\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<p>\ucd94\uac00\uc801\uc778 \uc778\uc99d \uc5c6\uc774\ub294 \uc774 \ucef4\ud4e8\ud130\uc5d0\uc11c \uacc4\uc815\uc5d0 \uc811\uadfc\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"auth_details_messages\">\r\n\t\t\t<div class=\"auth_details\">\r\n\t\t\t\tSteam \uace0\uac1d \uc9c0\uc6d0\uc5d0 \ubb38\uc758\ud558\uc2dc\uba74 \uc800\ud76c \uc9c1\uc6d0 \uc911 \ud55c \uba85\uc774 \uadc0\ud558\ub97c \ub3c4\uc640\ub4dc\ub9b4 \uac83\uc785\ub2c8\ub2e4. \uc800\ud76c\ub294 \uacc4\uc815 \uc811\uc18d\uc5d0 \ub300\ud55c \uc815\ub2f9\ud55c \uc694\uccad\uc744 \uc81c\uc77c \uba3c\uc800 \ucc98\ub9ac\ud560 \uc218 \uc788\ub3c4\ub85d \ub178\ub825\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4.\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"authcode_entry_area\">\r\n\t\t<\/div>\r\n\t\t<div class=\"modal_buttons\">\r\n\t\t\t<div class=\"auth_buttonset\" >\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=9400-IPAX-9398&auth=e39b5c227cffc8ae65414aba013e5fef\" class=\"auth_button leftbtn\" data-ajax=\"false\" data-externallink=\"1\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub354 \uc54c\uc544\ubcf4\uae30<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Intel&reg; Identity Protection Technology\uc5d0 \ub300\ud574\uc11c<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\" class=\"auth_button\" data-ajax=\"false\" data-externallink=\"1\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc640\uc8fc\uc138\uc694<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uace0\uac1d\uc9c0\uc6d0\uc758 \ub3c4\uc6c0\uc774 \ud544\uc694\ud55c \uac83 \uac19\uc2b5\ub2c8\ub2e4...<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t<\/div>\r\n\r\n\r\n\r\n\t<div class=\"login_modal loginTwoFactorCodeModal\" style=\"display: none\">\r\n\t\t<form>\r\n\t\t<div class=\"twofactorauth_message_area\">\r\n\t\t\t<div id=\"login_twofactorauth_icon\" class=\"auth_icon auth_icon_key\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_messages\" id=\"login_twofactorauth_messages\">\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc548\ub155\ud558\uc138\uc694 <span id=\"login_twofactorauth_message_entercode_accountname\"><\/span>!<\/div>\r\n\t\t\t\t\t<p>\uc774 \uacc4\uc815\uc740 \ud604\uc7ac Steam Guard \ubaa8\ubc14\uc77c \uc778\uc99d\uc744 \uc0ac\uc6a9 \uc911\uc785\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc5b4\uc774\ucfe0!<\/div>\r\n\t\t\t\t\t<p>\uc8c4\uc1a1\ud569\ub2c8\ub2e4\ub9cc, <br>\ud2c0\ub838\uc2b5\ub2c8\ub2e4...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\ub3c4\uc640\ub4dc\ub9ac\uaca0\uc2b5\ub2c8\ub2e4!<\/div>\r\n\t\t\t\t\t<p>\ubd88\ud3b8\uc744 \ub4dc\ub824 \uc8c4\uc1a1\ud569\ub2c8\ub2e4. \uadc0\ud558\uc5d0\uac8c Steam \uacc4\uc815\uc774 \uc18c\uc911\ud55c \uac83\uc744 \uc54c\uae30\uc5d0, \uc62c\ubc14\ub978 \uc0ac\uc6a9\uc790\ub9cc\uc774 \uc811\uc18d\ud560 \uc218 \uc788\ub3c4\ub85d \ucd5c\uc120\uc744 \ub2e4\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uacc4\uc815\uc758 \uc9c4\uc9dc \uc8fc\uc778\uc778\uc9c0 \ud655\uc778<\/div>\r\n\t\t\t\t\t<p><span id=\"login_twofactorauth_selfhelp_sms_remove_last_digits\"><\/span>\ub85c \ub05d\ub098\ub294 \uc804\ud654 \ubc88\ud638\ub85c \uacc4\uc815 \ubcf5\uad6c \ucf54\ub4dc\uac00 \uc804\uc1a1\ub420 \uac83\uc785\ub2c8\ub2e4. \uc54c\ub9de\uc740 \ucf54\ub4dc\ub97c \uc785\ub825\ud558\uc168\ub2e4\uba74 \uacc4\uc815\uc5d0 \ub4f1\ub85d\ub41c \ubaa8\ubc14\uc77c \uc778\uc99d\uae30\uac00 \uc81c\uac70\ub418\uba70 Steam Guard \ucf54\ub4dc\ub97c \ub4f1\ub85d\ub41c \uc774\uba54\uc77c \uc8fc\uc18c\ub85c \ubc1b\uac8c \ub429\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uacc4\uc815\uc758 \uc9c4\uc9dc \uc8fc\uc778\uc778\uc9c0 \ud655\uc778<\/div>\r\n\t\t\t\t\t<p><span id=\"login_twofactorauth_selfhelp_sms_remove_entercode_last_digits\"><\/span>\ub85c \ub05d\ub098\ub294 \ud734\ub300 \uc804\ud654 \ubc88\ud638\ub85c \ud655\uc778 \ucf54\ub4dc\uac00 \ub2f4\uae34 \ubb38\uc790 \uba54\uc2dc\uc9c0\ub97c \uc804\uc1a1\ud588\uc2b5\ub2c8\ub2e4. \uc544\ub798\uc5d0 \ubc1b\uc73c\uc2e0 \ucf54\ub4dc\ub97c \uc785\ub825\ud574 \uacc4\uc815\uc5d0 \ub4f1\ub85d\ub41c \ubaa8\ubc14\uc77c \uc778\uc99d\uae30\ub97c \uc81c\uac70\ud558\uc2e4 \uc218 \uc788\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc5b4\uc774\ucfe0!<\/div>\r\n\t\t\t\t\t<p>\uc8c4\uc1a1\ud569\ub2c8\ub2e4\ub9cc, <br>\ud2c0\ub838\uc2b5\ub2c8\ub2e4...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_twofactor_removed\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc131\uacf5!<\/div>\r\n\t\t\t\t\t<p>\uacc4\uc815\uc5d0 \ub4f1\ub85d\ub41c \ubaa8\ubc14\uc77c \uc778\uc99d\uae30\uac00 \uc81c\uac70\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ub2e4\uc74c\uc5d0 \ub85c\uadf8\uc778\uc744 \ud560 \ub54c\uc5d0\ub294 \ub4f1\ub85d\ub41c \uc774\uba54\uc77c\ub85c \uc800\ud68c\uac00 \ubcf4\ub0b8 Steam Guard \ucf54\ub4dc\ub97c \uc785\ub825\ud558\uc154\uc57c \ud569\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_twofactor_replaced\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc131\uacf5!<\/div>\r\n\t\t\t\t\t<p>\uc774\uc81c\ubd80\ud130 \uc774 \uc7a5\uce58\uc5d0\uc11c \ubaa8\ubc14\uc77c \uc778\uc99d\uae30 \ucf54\ub4dc\ub97c \ubc1b\uc744 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc774\uc804\uc5d0 \ub4f1\ub85d\ud588\ub358 \uc778\uc99d\uae30\ub098 \uc7a5\uce58\ub85c\ub294 \ub354 \uc774\uc0c1 \uc778\uc99d\uae30 \ucf54\ub4dc\ub97c \ubc1b\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_nosms\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\ubcf5\uad6c \ucf54\ub4dc\uac00 \uae30\uc5b5\ub098\uc2dc\ub098\uc694?<\/div>\r\n\t\t\t\t\t<p>Steam \uacc4\uc815\uc5d0 \ub4f1\ub85d\ub41c \uc804\ud654 \ubc88\ud638\uac00 \uc5c6\uae30 \ub54c\ubb38\uc5d0 \ubb38\uc790 \uba54\uc2dc\uc9c0\ub85c \uadc0\ud558\uac00 \uacc4\uc815\uc758 \uc8fc\uc778\uc784\uc744 \uc99d\uba85\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \uc778\uc99d\uae30\ub97c \uc124\uc815\ud560 \ub54c \ubc1b\uc73c\uc2e0 \ubcf5\uad6c \ucf54\ub4dc\uac00 \uae30\uc5b5\ub098\uc2dc\ub098\uc694? \ubcf5\uad6c \ucf54\ub4dc\ub294 R\ub85c \uc2dc\uc791\ud569\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\ubcf5\uad6c \ucf54\ub4dc\ub97c \uc785\ub825\ud558\uc138\uc694<\/div>\r\n\t\t\t\t\t<p>\uc544\ub798 \uc0c1\uc790\uc5d0 \ubcf5\uad6c \ucf54\ub4dc\ub97c \uc785\ub825\ud574\uc8fc\uc138\uc694. \ubcf5\uad6c \ucf54\ub4dc\ub294 R\ub85c \uc2dc\uc791\ud569\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc5b4\uc774\ucfe0!<\/div>\r\n\t\t\t\t\t<p>\uc8c4\uc1a1\ud569\ub2c8\ub2e4\ub9cc, <br>\ud2c0\ub838\uc2b5\ub2c8\ub2e4...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc5b4\uc774\ucfe0!<\/div>\r\n\t\t\t\t\t<p>\uc8c4\uc1a1\ud569\ub2c8\ub2e4\ub9cc, <br>\ud2c0\ub838\uc2b5\ub2c8\ub2e4...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_message\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc5b4\uc774\ucfe0!<\/div>\r\n\t\t\t\t\t<p>\uc8c4\uc1a1\ud569\ub2c8\ub2e4\ub9cc, <br>\ud2c0\ub838\uc2b5\ub2c8\ub2e4...<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_couldnthelp\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\ub3c4\uc640\ub4dc\ub9ac\uaca0\uc2b5\ub2c8\ub2e4!<\/div>\r\n\t\t\t\t\t<p>\uc0ac\uc6a9\ud558\ub358 \ubaa8\ubc14\uc77c \uae30\uae30, \uacc4\uc815\uc5d0 \ub4f1\ub85d\ub41c \ud734\ub300\uc804\ud654 \ubc88\ud638, Steam \uc778\uc99d\uae30\ub97c \ucd94\uac00\ud588\uc744 \ub54c \ubc1b\uc740 \ubcf5\uad6c \ucf54\ub4dc\ub97c \ubaa8\ub450 \uc783\uc5b4\ubc84\ub838\uc744 \uacbd\uc6b0\uc5d0\ub294 Steam \uc9c0\uc6d0\uc5d0 \ub3c4\uc6c0\uc744 \uc694\uccad\ud558\uc138\uc694.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_help\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\ub3c4\uc640\ub4dc\ub9ac\uaca0\uc2b5\ub2c8\ub2e4!<\/div>\r\n\t\t\t\t\t<p>\ubd88\ud3b8\uc744 \ub4dc\ub824 \uc8c4\uc1a1\ud569\ub2c8\ub2e4. \uadc0\ud558\uc5d0\uac8c Steam \uacc4\uc815\uc774 \uc18c\uc911\ud55c \uac83\uc744 \uc54c\uae30\uc5d0, \uc62c\ubc14\ub978 \uc0ac\uc6a9\uc790\ub9cc\uc774 \uc811\uc18d\ud560 \uc218 \uc788\ub3c4\ub85d \ucd5c\uc120\uc744 \ub2e4\ud558\uace0 \uc788\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_failure\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\uc8c4\uc1a1\ud569\ub2c8\ub2e4!<\/div>\r\n\t\t\t\t\t<p>\uadc0\ud558\uc758 \uc694\uccad\uc744 \ucc98\ub9ac\ud558\ub294 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div id=\"login_twofactorauth_details_messages\" class=\"twofactorauth_details_messages\">\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_entercode\" style=\"display: none;\">\r\n\t\t\t\tSteam \ubaa8\ubc14\uc77c \uc571\uc5d0 \ud604\uc7ac \ud45c\uc2dc\ub418\uc5b4 \uc788\ub294 \ucf54\ub4dc\ub97c \uc785\ub825\ud558\uc2dc\uae30 \ubc14\ub78d\ub2c8\ub2e4.\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t\ud734\ub300 \uc804\ud654\ub97c \uc783\uc5b4\ubc84\ub838\uac70\ub098 Steam \uc571\uc744 \uc0ad\uc81c\ud574 \ucf54\ub4dc\ub97c \ub354 \uc774\uc0c1 \ubc1b\uc744 \uc218 \uc5c6\ub294 \uacbd\uc6b0\uc5d0\ub294 \uacc4\uc815\uc5d0 \ub4f1\ub85d\ub41c \uc778\uc99d\uae30\ub97c \uc81c\uac70\ud558\uc154\ub3c4 \uc88b\uc2b5\ub2c8\ub2e4. \ud558\uc9c0\ub9cc \uc774\ub294 \uacc4\uc815\uc758 \ubcf4\uc548\uc744 \uc57d\ud558\uac8c \ub9cc\ub4e4\uae30 \ub54c\ubb38\uc5d0 \uace7\ubc14\ub85c \uc0c8\ub85c\uc6b4 \uc778\uc99d\uae30\ub97c \ub4f1\ub85d\ud574 \uc8fc\uc2dc\ub294 \uac83\uc774 \uc88b\uc2b5\ub2c8\ub2e4.\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_help\" style=\"display: none;\">\r\n\t\t\t\tSteam \uace0\uac1d\uc9c0\uc6d0\uc5d0 \uc5f0\ub77d\ud558\uc5ec \uc800\ud76c \uc9c1\uc6d0\uc758 \uc9c0\uc6d0\uc744 \ubc1b\uc73c\uc2dc\uae38 \ubc14\ub78d\ub2c8\ub2e4.\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_failure\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"twofactorauthcode_entry_area\">\r\n\t\t\t<div id=\"login_twofactor_authcode_entry\">\r\n\t\t\t\t<div class=\"twofactorauthcode_entry_box\">\r\n\t\t\t\t\t<input class=\"twofactorauthcode_entry_input authcode_placeholder\" id=\"twofactorcode_entry\" type=\"text\"\r\n\t\t\t\t\t\t   placeholder=\"\uc5ec\uae30\uc5d0 \ucf54\ub4dc\ub97c \uc785\ub825\ud558\uc138\uc694\" autocomplete=\"off\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div id=\"login_twofactor_authcode_help_supportlink\">\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=4020-ALZM-5519\">\r\n\t\t\t\t\tSteam \uace0\uac1d\uc9c0\uc6d0\uc5d0 \uc5f0\ub77d\ud558\uc5ec \uacc4\uc815 \uc811\uc18d\uc5d0 \ub300\ud55c \uc9c0\uc6d0 \uc694\uccad\t\t\t\t<\/a>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"modal_buttons\" id=\"login_twofactorauth_buttonsets\">\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_entercode\" style=\"display: none;\">\r\n\t\t\t\t<div type=\"submit\" class=\"auth_button leftbtn\" data-modalstate=\"submit\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc81c\ucd9c<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ub098\uc758 \uc778\uc99d \ucf54\ub4dc<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc640\uc8fc\uc138\uc694<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ub0b4 \ubaa8\ubc14\uc77c \uc778\uc99d\uae30 \ucf54\ub4dc\ub97c \ub354 \uc774\uc0c1 \ud655\uc778\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"submit\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub2e4\uc2dc \uc2dc\ub3c4\ud558\uace0 \uc2f6\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8\ub9ac\uace0 \uc704\uc5d0 \ub0b4 \uc778\uc99d \ucf54\ub4dc\ub97c \ub2e4\uc2dc \uc785\ub825\ud588\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc640\uc8fc\uc138\uc694<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uace0\uac1d\uc9c0\uc6d0\uc758 \ub3c4\uc6c0\uc744 \ubc1b\uc544\uc57c\uaca0\uc5b4\uc694...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_start\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\" style=\"font-size: 16px;\">\uc778\uc99d\uae30 \uc81c\uac70<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8\ub9ac\uace0 \uc774\uba54\uc77c\ub85c \ucf54\ub4dc \ubc1b\uae30<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_sms_reset_start\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc774 \uc7a5\uce58 \uc0ac\uc6a9<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8\ub9ac\uace0 \uc774 \uc571\uc5d0\uc11c \uc778\uc99d\uae30 \ucf54\ub4dc \ubc1b\uae30<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_sendcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc608!<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ubb38\uc790\ub97c \ubcf4\ub0b4\uc8fc\uc138\uc694<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc548\ub429\ub2c8\ub2e4.<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8 \uc804\ud654\ubc88\ud638\ub97c \ub354 \uc774\uc0c1 \uc4f0\uc9c0 \uc54a\uae30 \ub54c\ubb38\uc785\ub2c8\ub2e4.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove_entercode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc81c\ucd9c<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uc704\uc5d0 \ucf54\ub4dc\ub97c \uc785\ub825\ud588\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc6c0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ubb38\uc790 \uba54\uc2dc\uc9c0\ub97c \ubc1b\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc81c\ucd9c<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ucf54\ub4dc\ub97c \uc7ac\uc785\ub825\ud588\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc6c0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ubb38\uc790 \uba54\uc2dc\uc9c0\ub97c \ubc1b\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_twofactor_removed\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_complete\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub85c\uadf8\uc778<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ubaa8\ubc14\uc77c \uc778\uc99d\uae30\uac00 \uc81c\uac70\ub41c \ucc44\ub85c<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_twofactor_replaced\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_complete\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub85c\uadf8\uc778<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \ubaa8\ubc14\uc77c \uc571\uc73c\ub85c \uac00\uae30<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_nosms\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc608<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">R\ub85c \uc2dc\uc791\ud558\ub294 \ubcf5\uad6c \ucf54\ub4dc\ub97c \uac00\uc9c0\uace0 \uc788\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc544\ub2c8\uc694<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uadf8\ub7f0 \ucf54\ub4dc\ub97c \uac00\uc9c0\uace0 \uc788\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc81c\ucd9c<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ub0b4 \ubcf5\uad6c \ucf54\ub4dc<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc6c0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uc9c0\uc6d0\uc758 \ub3c4\uc6c0\uc774 \ud544\uc694\ud55c \uac83 \uac19\uc2b5\ub2c8\ub2e4...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\uc81c\ucd9c<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\ucf54\ub4dc\ub97c \uc7ac\uc785\ub825\ud588\uc2b5\ub2c8\ub2e4. \ub2e4\uc2dc \uc2dc\ub3c4\ud574\uc8fc\uc138\uc694.<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc6c0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uc9c0\uc6d0\uc758 \ub3c4\uc6c0\uc774 \ud544\uc694\ud55c \uac83 \uac19\uc2b5\ub2c8\ub2e4...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\ub3c4\uc6c0\uc774 \ud544\uc694\ud569\ub2c8\ub2e4<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \uc9c0\uc6d0\uc758 \ub3c4\uc6c0\uc774 \ud544\uc694\ud55c \uac83 \uac19\uc2b5\ub2c8\ub2e4...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_couldnthelp\" style=\"display: none;\">\r\n\t\t\t\t<a class=\"auth_button leftbtn\" href=\"https:\/\/help.steampowered.com\/\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">Steam \uc9c0\uc6d0\uc5d0 \uc5f0\ub77d\ud558\uc5ec<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\uacc4\uc815\uc5d0 \ub85c\uadf8\uc778\ud558\ub294 \ub370 \ub3c4\uc6c0\uc744 \ubc1b\uc73c\uc138\uc694<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_waiting\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div style=\"display: none;\">\r\n\t\t\t<input type=\"submit\">\r\n\t\t<\/div>\r\n\t\t<\/form>\r\n\t<\/div>\r\n<\/div>\r\n" );
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

