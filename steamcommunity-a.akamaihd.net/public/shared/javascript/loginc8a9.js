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
			ShowAlertDialog( 'エラー', 'Steam サーバーとの通信中に問題が発生しました。 後でもう一度お試しください。' );
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
			ShowDialog( 'Intel® Identity Protection Technology', this.m_$ModalIPT.show() ).always( $J.proxy( this.ClearLoginForm, this ) );
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
	this.m_EmailAuthModal = ShowDialog( 'Steam ガード', this.m_$ModalAuthCode.show() )
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
	this.m_TwoFactorModal = ShowDialog( 'Steam ガードモバイル認証', this.m_$ModalTwoFactor.show() )
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
		CLoginPromptManager.sm_$Modals = $J( "<div id=\"loginModals\">\r\n\t<div class=\"login_modal loginAuthCodeModal\" style=\"display: none\">\r\n\t\t<form data-ajax=\"false\">\r\n\t\t\t<div class=\"auth_message_area\">\r\n\t\t\t\t<div id=\"auth_icon\" class=\"auth_icon auth_icon_key\">\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_messages\" id=\"auth_messages\">\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\u3053\u3093\u306b\u3061\u306f\uff01<\/div>\r\n\t\t\t\t\t\t<p>\u65b0\u3057\u3044\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u304b\u30d6\u30e9\u30a6\u30b6\u304b\u3089Steam\u306b\u30ed\u30b0\u30a4\u30f3\u3057\u305f\u307f\u305f\u3044\u3067\u3059\u306d\u3002\u3057\u3070\u3089\u304f\u3076\u308a\u306a\u3060\u3051\u3067\u3057\u3087\u3046\u304b...<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_checkspam\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\u30b9\u30d1\u30e0\u3068\u9593\u9055\u308f\u308c\u3066\u3044\u306a\u3044\u3067\u3059\u304b\uff1f<\/div>\r\n\t\t\t\t\t\t<p>\u30b9\u30d1\u30e0\u30d5\u30a9\u30eb\u30c0\u5185\u3092\u30c1\u30a7\u30c3\u30af\u3057\u307e\u3057\u305f\u304b? Steam \u30b5\u30dd\u30fc\u30c8\u304b\u3089\u306e\u65b0\u3057\u3044\u30e1\u30c3\u30bb\u30fc\u30b8\u304c\u53d7\u4fe1\u30dc\u30c3\u30af\u30b9\u5185\u306b\u7121\u3051\u308c\u3070\u3001 \u78ba\u8a8d\u3057\u3066\u307f\u3066\u304f\u3060\u3055\u3044\u3002<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_success\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\u6210\u529f!<\/div>\r\n\t\t\t\t\t\t<p>\u3053\u308c\u3067\u3001 \u3042\u306a\u305f\u306eSteam\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u30a2\u30af\u30bb\u30b9\u3059\u308b\u3053\u3068\u304c\u51fa\u6765\u308b\u3088\u3046\u306b\u306a\u308a\u307e\u3057\u305f\u3002<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\u304a\u3063\u3068!<\/div>\r\n\t\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001 <br>\u30b3\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u30fb\u30fb\u30fb<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div class=\"auth_message\" id=\"auth_message_help\" style=\"display: none;\">\r\n\t\t\t\t\t\t<div class=\"auth_modal_h1\">\u30b5\u30dd\u30fc\u30c8\u3057\u307e\u3059\uff01<\/div>\r\n\t\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001\u554f\u984c\u304c\u767a\u751f\u3057\u3066\u3044\u308b\u3088\u3046\u3067\u3059\u3002\u3042\u306a\u305f\u306eSteam \u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u91cd\u8981\u6027\u306f\u627f\u77e5\u3057\u3066\u3044\u307e\u3059\uff01\u3042\u306a\u305f\u304c\u518d\u3073\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u30a2\u30af\u30bb\u30b9\u3059\u308b\u4e8b\u304c\u3067\u304d\u308b\u3088\u3046\u3001\u5168\u529b\u3067\u30b5\u30dd\u30fc\u30c8\u3059\u308b\u3053\u3068\u3092\u7d04\u675f\u3057\u307e\u3059\u3002<\/p>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div id=\"auth_details_messages\" class=\"auth_details_messages\">\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t\u30a2\u30ab\u30a6\u30f3\u30c8\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u306e\u4e00\u74b0\u3068\u3057\u3066\u3001\u3053\u306e\u30d6\u30e9\u30a6\u30b6\u3067 Steam \u306b\u63a5\u7d9a\u3059\u308b\u306b\u306f\u3001\u3042\u306a\u305f\u306e\u767b\u9332\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u3067\u3042\u308b <span id=\"emailauth_entercode_emaildomain\"><\/span> \u3078\u9001\u4fe1\u3055\u308c\u305f\u5c02\u7528\u306e\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_success\" style=\"display: none;\">\r\n\t\t\t\t\t\u516c\u5171\u3001\u5171\u7528\u306e\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u3092\u304a\u4f7f\u3044\u306e\u5834\u5408\u306f\u3001\u30d6\u30e9\u30a6\u30b6\u3092\u7d42\u4e86\u3059\u308b\u969b\u306b\u5fc5\u305aSteam\u304b\u3089\u30ed\u30b0\u30a2\u30a6\u30c8\u3057\u3066\u4e0b\u3055\u3044\u3002\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_details\" id=\"auth_details_help\" style=\"display: none;\">\r\n\t\t\t\t\t\u304a\u624b\u6570\u3067\u3059\u304c\u3001Steam \u30b5\u30dd\u30fc\u30c8\u306b\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002\u6b63\u5f53\u306a\u30a2\u30ab\u30a6\u30f3\u30c8\u30a2\u30af\u30bb\u30b9\u306b\u95a2\u3059\u308b\u30b5\u30dd\u30fc\u30c8\u306f\u3001\u6700\u512a\u5148\u4e8b\u9805\u3068\u3057\u3066\u5bfe\u5fdc\u3044\u305f\u3057\u307e\u3059\u3002\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"authcode_entry_area\">\r\n\t\t\t\t<div id=\"authcode_entry\">\r\n\t\t\t\t\t<div class=\"authcode_entry_box\">\r\n\t\t\t\t\t\t<input class=\"authcode_entry_input authcode_placeholder\" id=\"authcode\" type=\"text\" value=\"\"\r\n\t\t\t\t\t\t\t   placeholder=\"\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\">\r\n\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div id=\"authcode_help_supportlink\">\r\n\t\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=4020-ALZM-5519\" data-ajax=\"false\" data-externallink=\"1\">Steam \u30b5\u30dd\u30fc\u30c8\u306b\u30a2\u30ab\u30a6\u30f3\u30c8\u30a2\u30af\u30bb\u30b9\u306e\u554f\u3044\u5408\u308f\u305b\u3092\u884c\u3046<\/a>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"modal_buttons\" id=\"auth_buttonsets\">\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\u9001\u4fe1<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\u81ea\u5206\u306e\u30b9\u30da\u30b7\u30e3\u30eb\u30a2\u30af\u30bb\u30b9\u30b3\u30fc\u30c9<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"checkspam\" class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\u3069\u3093\u306a\u30e1\u30c3\u30bb\u30fc\u30b8\u3067\u3059\u304b?<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Steam \u30b5\u30dd\u30fc\u30c8\u304b\u3089\u306e\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u53d7\u3051\u53d6\u3063\u3066\u3044\u307e\u305b\u3093...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_checkspam\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\u898b\u3064\u3051\u307e\u3057\u305f\uff01<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\u305d\u3057\u3066\u4e0a\u306e\u6b04\u306b\u30b9\u30da\u30b7\u30e3\u30eb\u30a2\u30af\u30bb\u30b9\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u307e\u3057\u305f<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"help\"  class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\u672a\u3060\u898b\u3064\u304b\u308a\u307e\u305b\u3093...<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">Steam \u30b5\u30dd\u30fc\u30c8 \u304b\u3089\u306e\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u53d7\u3051\u53d6\u3063\u3066\u3044\u307e\u305b\u3093...<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_success\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_button auth_button_spacer\">\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<a data-modalstate=\"complete\" class=\"auth_button\" id=\"success_continue_btn\" href=\"javascript:void(0);\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">Steam \u3078\u9032\u3080!<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">&nbsp;<br>&nbsp;<\/div>\r\n\t\t\t\t\t<\/a>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div data-modalstate=\"submit\" class=\"auth_button leftbtn\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u307e\u3059<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\u305d\u3057\u3066\u4e0a\u306e\u6b04\u306b\u30b9\u30da\u30b7\u30e3\u30eb\u30a2\u30af\u30bb\u30b9\u30b3\u30fc\u30c9\u3092\u518d\u5165\u529b\u3057\u307e\u3057\u305f<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div data-modalstate=\"help\" class=\"auth_button\">\r\n\t\t\t\t\t\t<div class=\"auth_button_h3\">\u30d8\u30eb\u30d7\uff01<\/div>\r\n\t\t\t\t\t\t<div class=\"auth_button_h5\">\u3069\u3046\u3084\u3089Steam \u30b5\u30dd\u30fc\u30c8\u306e\u52a9\u3051\u304c\u8981\u308a\u305d\u3046\u3067\u3059\u30fb\u30fb\u30fb<\/div>\r\n\t\t\t\t\t<\/div>\r\n\t\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_buttonset\" id=\"auth_buttonset_waiting\" style=\"display: none;\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div style=\"\" id=\"auth_details_computer_name\" class=\"auth_details_messages\">\r\n\t\t\t\tSteam\u30ac\u30fc\u30c9\u304c\u6709\u52b9\u306b\u306a\u3063\u3066\u3044\u308b\u30c7\u30d0\u30a4\u30b9\u306e\u30ea\u30b9\u30c8\u306e\u4e2d\u304b\u3089\u3001\u7c21\u5358\u306b\u3053\u306e\u30d6\u30e9\u30a6\u30b6\u3092\u898b\u5206\u3051\u308b\u305f\u3081\u306b\u3001\u3053\u306e\u30d6\u30e9\u30a6\u30b6\u306b\u5206\u304b\u308a\u3084\u3059\u3044\u540d\u524d\u3092\u4ed8\u3051\u3066\u304f\u3060\u3055\u3044 - \u6700\u4f4e6\u6587\u5b57\u3067\u3059\u3002\t\t\t\t<div id=\"friendly_name_box\" class=\"friendly_name_box\">\r\n\t\t\t\t\t<input class=\"authcode_entry_input authcode_placeholder\" id=\"friendlyname\" type=\"text\"\r\n\t\t\t\t\t\t   placeholder=\"\u5206\u304b\u308a\u3084\u3059\u3044\u540d\u524d\u3092\u5165\u529b\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div style=\"display: none;\">\r\n\t\t\t\t<input type=\"submit\">\r\n\t\t\t<\/div>\r\n\t\t<\/form>\r\n\t<\/div>\r\n\r\n\t<div class=\"login_modal loginIPTModal\" style=\"display: none\">\r\n\t\t<div class=\"auth_message_area\">\r\n\t\t\t<div class=\"auth_icon ipt_icon\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_messages\">\r\n\t\t\t\t<div class=\"auth_message\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u7533\u3057\u8a33\u3054\u3056\u3044\u307e\u305b\u3093<\/div>\r\n\t\t\t\t\t<p>\u3053\u306e\u30b3\u30f3\u30d4\u30e5\u30fc\u30bf\u3092\u307e\u3060\u8a8d\u8a3c\u3057\u3066\u3044\u306a\u3044\u305f\u3081\u3001 \u3053\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u3067\u306f\u30a2\u30af\u30bb\u30b9\u3067\u304d\u307e\u305b\u3093\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"auth_details_messages\">\r\n\t\t\t<div class=\"auth_details\">\r\n\t\t\t\t\u304a\u624b\u6570\u3067\u3059\u304c\u3001Steam \u30b5\u30dd\u30fc\u30c8\u306b\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002\u6b63\u5f53\u306a\u30a2\u30ab\u30a6\u30f3\u30c8\u30a2\u30af\u30bb\u30b9\u306b\u95a2\u3059\u308b\u30b5\u30dd\u30fc\u30c8\u306f\u3001\u6700\u512a\u5148\u4e8b\u9805\u3068\u3057\u3066\u5bfe\u5fdc\u3044\u305f\u3057\u307e\u3059\u3002\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"authcode_entry_area\">\r\n\t\t<\/div>\r\n\t\t<div class=\"modal_buttons\">\r\n\t\t\t<div class=\"auth_buttonset\" >\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=9400-IPAX-9398&auth=e39b5c227cffc8ae65414aba013e5fef\" class=\"auth_button leftbtn\" data-ajax=\"false\" data-externallink=\"1\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u8a73\u7d30<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Intel&reg; Identity Protection Technology \u306b\u3064\u3044\u3066<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\" class=\"auth_button\" data-ajax=\"false\" data-externallink=\"1\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u30d8\u30eb\u30d7\uff01<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u3069\u3046\u3084\u3089Steam \u30b5\u30dd\u30fc\u30c8\u306e\u52a9\u3051\u304c\u8981\u308a\u305d\u3046\u3067\u3059\u30fb\u30fb\u30fb<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t<\/div>\r\n\r\n\r\n\r\n\t<div class=\"login_modal loginTwoFactorCodeModal\" style=\"display: none\">\r\n\t\t<form>\r\n\t\t<div class=\"twofactorauth_message_area\">\r\n\t\t\t<div id=\"login_twofactorauth_icon\" class=\"auth_icon auth_icon_key\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_messages\" id=\"login_twofactorauth_messages\">\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u3053\u3093\u306b\u3061\u306f <span id=\"login_twofactorauth_message_entercode_accountname\"><\/span>!<\/div>\r\n\t\t\t\t\t<p>\u3053\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u306f\u73fe\u5728Steam \u30ac\u30fc\u30c9\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u3092\u4f7f\u7528\u3057\u3066\u3044\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u304a\u3063\u3068!<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001 <br>\u30b3\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u30fb\u30fb\u30fb<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u79c1\u305f\u3061\u304c\u529b\u306b\u306a\u308a\u307e\u3059\uff01<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001\u554f\u984c\u304c\u767a\u751f\u3057\u3066\u3044\u308b\u3088\u3046\u3067\u3059\u3002\u3042\u306a\u305f\u306e Steam \u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u91cd\u8981\u6027\u3092\u7406\u89e3\u3057\u3066\u3044\u307e\u3059\u3002\u3042\u306a\u305f\u304c\u518d\u3073\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u30a2\u30af\u30bb\u30b9\u3059\u308b\u4e8b\u304c\u3067\u304d\u308b\u3088\u3046\u3001\u5168\u529b\u3067\u30b5\u30dd\u30fc\u30c8\u3059\u308b\u3053\u3068\u3092\u7d04\u675f\u3057\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u6240\u6709\u6a29\u3092\u78ba\u8a8d<\/div>\r\n\t\t\t\t\t<p>\u30c6\u30ad\u30b9\u30c8\u30e1\u30c3\u30bb\u30fc\u30b8\u3068\u3057\u3066<span id=\"login_twofactorauth_selfhelp_sms_remove_last_digits\"><\/span>\u3067\u7d42\u4e86\u3059\u308b\u643a\u5e2f\u756a\u53f7\u306b\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u3092\u9001\u4fe1\u3057\u307e\u3059\u3002\u30b3\u30fc\u30c9\u5165\u529b\u5f8c \u3042\u306a\u305f\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u304b\u3089\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u6a5f\u5668\u304c\u524a\u9664\u3055\u308c\u3001\u305d\u308c\u4ee5\u964d\u306eSteam \u30ac\u30fc\u30c9\u306e\u53d7\u3051\u53d6\u308a\u306fE\u30e1\u30fc\u30eb\u304c\u4f7f\u7528\u3055\u308c\u308b\u3088\u3046\u306b\u306a\u308a\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove_entercode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u6240\u6709\u6a29\u3092\u78ba\u8a8d<\/div>\r\n\t\t\t\t\t<p><span id=\"login_twofactorauth_selfhelp_sms_remove_entercode_last_digits\"><\/span>\u3067\u7d42\u308f\u308b\u643a\u5e2f\u756a\u53f7\u306b\u78ba\u8a8d\u30b3\u30fc\u30c9\u3092\u542b\u3093\u3060\u30c6\u30ad\u30b9\u30c8\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u4fe1\u3057\u307e\u3057\u305f\u3002\u4ee5\u4e0b\u306b\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3059\u308b\u3068\u3001\u3042\u306a\u305f\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u304b\u3089\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u6a5f\u5668\u304c\u524a\u9664\u3055\u308c\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_sms_remove_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u304a\u3063\u3068!<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001 <br>\u30b3\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u30fb\u30fb\u30fb<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_twofactor_removed\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u6210\u529f!<\/div>\r\n\t\t\t\t\t<p>\u3042\u306a\u305f\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u304b\u3089\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u6a5f\u5668\u3092\u524a\u9664\u3057\u307e\u3057\u305f\u3002\u6b21\u56de\u4ee5\u964d\u306e\u30ed\u30b0\u30a4\u30f3\u306b\u306f\u3001\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u767b\u9332\u3055\u308c\u305f\u305f\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u306b\u9001\u4fe1\u3055\u308c\u308b Steam \u30ac\u30fc\u30c9\u30b3\u30fc\u30c9\u3092\u4f7f\u7528\u3057\u3066\u4e0b\u3055\u3044\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_twofactor_replaced\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u6210\u529f!<\/div>\r\n\t\t\t\t\t<p>\u3053\u306e\u30c7\u30d0\u30a4\u30b9\u3092\u4f7f\u7528\u3057\u3066\u3001\u30a2\u30ab\u30a6\u30f3\u30c8\u7528\u306e\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u30b3\u30fc\u30c9\u3092\u5165\u624b\u3067\u304d\u308b\u3088\u3046\u306b\u306a\u308a\u307e\u3057\u305f\u3002\u4ee5\u524d\u30b3\u30fc\u30c9\u3092\u751f\u6210\u3057\u3066\u3044\u305f\u30c7\u30d0\u30a4\u30b9\u3092\u542b\u3081\u3001\u3053\u306e\u6a5f\u5668\u4ee5\u5916\u306e\u30c7\u30d0\u30a4\u30b9\u304b\u3089\u3042\u306a\u305f\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u7528\u306e\u30b3\u30fc\u30c9\u3092\u751f\u6210\u3067\u304d\u306a\u304f\u306a\u308a\u307e\u3057\u305f\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_nosms\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u3092\u6301\u3063\u3066\u3044\u307e\u3059\u304b\uff1f<\/div>\r\n\t\t\t\t\t<p>\u3053\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u96fb\u8a71\u756a\u53f7\u3092\u767b\u9332\u3057\u3066\u3044\u307e\u305b\u3093\u306e\u3067\u3001\u30c6\u30ad\u30b9\u30c8\u30e1\u30c3\u30bb\u30fc\u30b8\u7d4c\u7531\u3067\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u6240\u6709\u6a29\u3092\u78ba\u8a8d\u3059\u308b\u3053\u3068\u304c\u3067\u304d\u307e\u305b\u3093\u3002\u643a\u5e2f\u8a8d\u8a3c\u6a5f\u5668\u3092\u8a2d\u5b9a\u3057\u305f\u969b\u306b\u66f8\u304d\u7559\u3081\u305f\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u3092\u304a\u6301\u3061\u3067\u3059\u304b\uff1f\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u306f\u30a2\u30eb\u30d5\u30a1\u30d9\u30c3\u30c8\u306e\u300cR\u300d\u3067\u59cb\u307e\u308a\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u3092\u5165\u529b<\/div>\r\n\t\t\t\t\t<p>\u4ee5\u4e0b\u306e\u30dc\u30c3\u30af\u30b9\u5185\u306b\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u306f\u30a2\u30eb\u30d5\u30a1\u30d9\u30c3\u30c8\u306e\u300cR\u300d\u3067\u59cb\u307e\u308a\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u304a\u3063\u3068!<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001 <br>\u30b3\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u30fb\u30fb\u30fb<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u304a\u3063\u3068!<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001 <br>\u30b3\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u30fb\u30fb\u30fb<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_rcode_message\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u304a\u3063\u3068!<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001 <br>\u30b3\u30fc\u30c9\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u30fb\u30fb\u30fb<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_couldnthelp\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u79c1\u305f\u3061\u304c\u529b\u306b\u306a\u308a\u307e\u3059\uff01<\/div>\r\n\t\t\t\t\t<p>\u30e2\u30d0\u30a4\u30eb\u30c7\u30d0\u30a4\u30b9\u3084\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u95a2\u9023\u4ed8\u3051\u3089\u308c\u305f\u643a\u5e2f\u96fb\u8a71\u756a\u53f7\u306b\u30a2\u30af\u30bb\u30b9\u3067\u304d\u306a\u304f\u306a\u308a\u3001\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u8ffd\u52a0\u6642\u306b\u66f8\u304d\u7559\u3081\u305f\u30ea\u30ab\u30d0\u30ea\u30fc\u30b3\u30fc\u30c9\u3092\u7d1b\u5931\u3057\u305f\u5834\u5408\u306f\u3001\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u30a2\u30af\u30bb\u30b9\u3092\u5fa9\u65e7\u652f\u63f4\u3059\u308b\u305f\u3081\u306bSteam \u30b5\u30dd\u30fc\u30c8\u306b\u9023\u7d61\u3057\u3066\u304f\u3060\u3055\u3044\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_help\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u79c1\u305f\u3061\u304c\u529b\u306b\u306a\u308a\u307e\u3059\uff01<\/div>\r\n\t\t\t\t\t<p>\u7533\u3057\u8a33\u3042\u308a\u307e\u305b\u3093\u304c\u3001\u554f\u984c\u304c\u767a\u751f\u3057\u3066\u3044\u308b\u3088\u3046\u3067\u3059\u3002\u3042\u306a\u305f\u306e Steam \u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u91cd\u8981\u6027\u3092\u7406\u89e3\u3057\u3066\u3044\u307e\u3059\u3002\u3042\u306a\u305f\u304c\u518d\u3073\u30a2\u30ab\u30a6\u30f3\u30c8\u306b\u30a2\u30af\u30bb\u30b9\u3059\u308b\u4e8b\u304c\u3067\u304d\u308b\u3088\u3046\u3001\u5168\u529b\u3067\u30b5\u30dd\u30fc\u30c8\u3059\u308b\u3053\u3068\u3092\u7d04\u675f\u3057\u307e\u3059\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"twofactorauth_message\" id=\"login_twofactorauth_message_selfhelp_failure\" style=\"display: none;\">\r\n\t\t\t\t\t<div class=\"auth_modal_h1\">\u7533\u3057\u8a33\u3054\u3056\u3044\u307e\u305b\u3093\u3002<\/div>\r\n\t\t\t\t\t<p>\u30ea\u30af\u30a8\u30b9\u30c8\u306e\u51e6\u7406\u4e2d\u306b\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002<\/p>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div id=\"login_twofactorauth_details_messages\" class=\"twofactorauth_details_messages\">\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_entercode\" style=\"display: none;\">\r\n\t\t\t\tSteam \u30e2\u30d0\u30a4\u30eb\u30a2\u30d7\u30ea \u306b\u8868\u793a\u3055\u308c\u3066\u3044\u308b\u73fe\u5728\u306e\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\uff1a\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t\u30e2\u30d0\u30a4\u30eb\u30c7\u30d0\u30a4\u30b9\u3092\u7d1b\u5931\u3057\u305f\u3001\u3082\u3057\u304f\u306fSteam \u30a2\u30d7\u30ea\u3092\u30a2\u30f3\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb\u3057\u30ea\u30ab\u30d0\u30ea\u30fc\u30b3\u30fc\u30c9\u304c\u53d6\u5f97\u3067\u304d\u306a\u3044\u5834\u5408\u3001\u30a2\u30ab\u30a6\u30f3\u30c8\u304b\u3089\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u3092\u89e3\u9664\u3059\u308b\u3053\u3068\u304c\u3067\u304d\u307e\u3059\u3002\u3053\u306e\u7d50\u679c\u3001\u30a2\u30ab\u30a6\u30f3\u30c8\u306e\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u304c\u4f4e\u4e0b\u3059\u308b\u306e\u3067\u3001\u3042\u3068\u3067\u65b0\u3057\u3044\u30e2\u30d0\u30a4\u30eb\u30c7\u30d0\u30a4\u30b9\u306b\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u3092\u8ffd\u52a0\u3057\u306a\u3051\u308c\u3070\u306a\u308a\u307e\u305b\u3093\u3002\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_help\" style=\"display: none;\">\r\n\t\t\t\t\u304a\u624b\u6570\u3067\u3059\u304c\u3001Steam \u30b5\u30dd\u30fc\u30c8\u306b\u304a\u554f\u3044\u5408\u308f\u305b\u304f\u3060\u3055\u3044\u3002\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_failure\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"twofactorauth_details\" id=\"login_twofactorauth_details_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"twofactorauthcode_entry_area\">\r\n\t\t\t<div id=\"login_twofactor_authcode_entry\">\r\n\t\t\t\t<div class=\"twofactorauthcode_entry_box\">\r\n\t\t\t\t\t<input class=\"twofactorauthcode_entry_input authcode_placeholder\" id=\"twofactorcode_entry\" type=\"text\"\r\n\t\t\t\t\t\t   placeholder=\"\u3053\u3053\u306b\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u3066\u4e0b\u3055\u3044\" autocomplete=\"off\">\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div id=\"login_twofactor_authcode_help_supportlink\">\r\n\t\t\t\t<a href=\"https:\/\/support.steampowered.com\/kb_article.php?ref=4020-ALZM-5519\">\r\n\t\t\t\t\tSteam \u30b5\u30dd\u30fc\u30c8\u306b\u30a2\u30ab\u30a6\u30f3\u30c8\u30a2\u30af\u30bb\u30b9\u306b\u3064\u3044\u3066\u554f\u3044\u5408\u308f\u305b\u308b\t\t\t\t<\/a>\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div class=\"modal_buttons\" id=\"login_twofactorauth_buttonsets\">\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_entercode\" style=\"display: none;\">\r\n\t\t\t\t<div type=\"submit\" class=\"auth_button leftbtn\" data-modalstate=\"submit\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u9001\u4fe1<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u81ea\u5206\u306e\u8a8d\u8a3c\u6a5f\u5668\u306e\u30b3\u30fc\u30c9<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u30b3\u30fc\u30c9\u3078\u306e\u30a2\u30af\u30bb\u30b9\u3092\u5931\u3044\u307e\u3057\u305f<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"submit\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u307e\u3059<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u305d\u3057\u3066\u4e0a\u306e\u6b04\u306b\u8a8d\u8a3c\u6a5f\u5668\u306e\u30b3\u30fc\u30c9\u3092\u518d\u5165\u529b\u3057\u307e\u3057\u305f<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u3069\u3046\u3084\u3089Steam \u30b5\u30dd\u30fc\u30c8\u306e\u52a9\u3051\u304c\u8981\u308a\u305d\u3046\u3067\u3059\u30fb\u30fb\u30fb<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div style=\"clear: left;\"><\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_start\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\" style=\"font-size: 16px;\">\u8a8d\u8a3c\u7528\u6a5f\u5668\u3092\u524a\u9664<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30e1\u30fc\u30eb\u3067\u30b3\u30fc\u30c9\u3092\u53d7\u3051\u53d6\u308b\u3088\u3046\u306b\u3057\u307e\u3059<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_sms_reset_start\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u3053\u306e\u30c7\u30d0\u30a4\u30b9\u3092\u4f7f\u7528\u3059\u308b<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u3053\u306e\u30a2\u30d7\u30ea\u3067\u8a8d\u8a3c\u30b3\u30fc\u30c9\u3092\u751f\u6210\u3059\u308b\u3088\u3046\u306b\u3057\u307e\u3059<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_sendcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">OK!<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30c6\u30ad\u30b9\u30c8\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u4fe1\u3057\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u3067\u304d\u307e\u305b\u3093<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u305d\u306e\u643a\u5e2f\u756a\u53f7\u3078\u306e\u30a2\u30af\u30bb\u30b9\u306f\u3082\u3046\u3042\u308a\u307e\u305b\u3093\u3002<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove_entercode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u9001\u4fe1<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u4e0a\u306b\u30b3\u30fc\u30c9\u3092\u5165\u529b\u3057\u307e\u3057\u305f<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30c6\u30ad\u30b9\u30c8\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u53d7\u3051\u53d6\u308a\u307e\u305b\u3093<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_sms_remove_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u9001\u4fe1<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30b3\u30fc\u30c9\u3092\u518d\u5165\u529b\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u307e\u3059\u3002<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_nosms\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30c6\u30ad\u30b9\u30c8\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u53d7\u3051\u53d6\u308a\u307e\u305b\u3093<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_twofactor_removed\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_complete\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u30ed\u30b0\u30a4\u30f3<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30e2\u30d0\u30a4\u30eb\u8a8d\u8a3c\u6a5f\u5668\u3092\u524a\u9664\u3057\u3066<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_twofactor_replaced\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_sms_remove_complete\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u30ed\u30b0\u30a4\u30f3<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \u30e2\u30d0\u30a4\u30eb\u30a2\u30d7\u30ea\u30b1\u30fc\u30b7\u30e7\u30f3\u3078<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_nosms\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u306f\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">'R'\u3067\u59cb\u307e\u308b\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9\u3092\u6301\u3063\u3066\u3044\u307e\u3059<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u3044\u3044\u3048<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u305d\u3093\u306a\u30b3\u30fc\u30c9\u306f\u6301\u3063\u3066\u3044\u307e\u305b\u3093<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u9001\u4fe1<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30ea\u30ab\u30d0\u30ea\u30b3\u30fc\u30c9<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \u30b5\u30dd\u30fc\u30c8\u304b\u3089\u306e\u52a9\u3051\u304c\u5fc5\u8981\u3067\u3059...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode_incorrectcode\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button leftbtn\" data-modalstate=\"selfhelp_rcode_checkcode\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u9001\u4fe1<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30b3\u30fc\u30c9\u3092\u518d\u5165\u529b\u3057\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u8a66\u3057\u307e\u3059\u3002<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \u30b5\u30dd\u30fc\u30c8\u304b\u3089\u306e\u52a9\u3051\u304c\u5fc5\u8981\u3067\u3059...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_rcode_incorrectcode_exhausted\" style=\"display: none;\">\r\n\t\t\t\t<div class=\"auth_button\" data-modalstate=\"selfhelp_couldnthelp\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u52a9\u3051\u3066\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">Steam \u30b5\u30dd\u30fc\u30c8\u304b\u3089\u306e\u52a9\u3051\u304c\u5fc5\u8981\u3067\u3059...<\/div>\r\n\t\t\t\t<\/div>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_selfhelp_couldnthelp\" style=\"display: none;\">\r\n\t\t\t\t<a class=\"auth_button leftbtn\" href=\"https:\/\/help.steampowered.com\/\">\r\n\t\t\t\t\t<div class=\"auth_button_h3\">\u3054\u9023\u7d61\u304f\u3060\u3055\u3044<\/div>\r\n\t\t\t\t\t<div class=\"auth_button_h5\">\u30a2\u30ab\u30a6\u30f3\u30c8\u30a2\u30af\u30bb\u30b9\u3078\u306e\u304a\u624b\u4f1d\u3044\u306f<\/div>\r\n\t\t\t\t<\/a>\r\n\t\t\t<\/div>\r\n\t\t\t<div class=\"auth_buttonset\" id=\"login_twofactorauth_buttonset_waiting\" style=\"display: none;\">\r\n\t\t\t<\/div>\r\n\t\t<\/div>\r\n\t\t<div style=\"display: none;\">\r\n\t\t\t<input type=\"submit\">\r\n\t\t<\/div>\r\n\t\t<\/form>\r\n\t<\/div>\r\n<\/div>\r\n" );
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

