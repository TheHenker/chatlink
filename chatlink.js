'use strict';

var Global = {
	randomString : function(length) {
		if (!length)
			length = 20;
		var key = "";
		var possible = "abcdefghijklmnopqrstuvwxyz0123456789";
		for (var i = 0; i < length; ++i)
			key += possible.charAt(Math.floor(Math.random() * possible.length));
		return key;
	},
	getUrlKey : function() {
		var key = window.location.hash;
		if (key) {
			return key.substring(1).toLowerCase();
		}
		return false;
	},
	encrypt : function(input, key) {
		var encrypted = CryptoJS.AES.encrypt(input, key, { format: JsonFormatter });
		return encrypted.toString();
	},
	decrypt : function(input, key) {
		if (!input) // empty string or smth
			return input;
		
		var decrypted = CryptoJS.AES.decrypt(input, key, { format: JsonFormatter });
		return decrypted.toString(CryptoJS.enc.Utf8);
	},
	generateId : function(key) {
		return Global.customHash(key, 'The Implementation of Freedom');
	},
	keccakHash : function(data, salt) {
		return CryptoJS.SHA3(data + salt).toString();
	},
	customHash : function(data, salt) {
		var intermediateHash = data + salt;
		for (var i = 0; i < 21; ++i) {
			intermediateHash = CryptoJS.SHA3(intermediateHash + data).toString();
		}
		return intermediateHash;
	},
	isSmallScreen : function() {
		return $(window).width() < 633;  
	},
	checkFunctions : function(object, methodNames) {
		for (var i = 0, l = methodNames.length; i < l; i++) {
			var methodName = methodNames[i];
			if (typeof object[methodName] != 'function') {
				console.error('Object ' + (object.constructor.name) + ' has no function named "' + methodName + '"!');
			}
		}
	}
};


;
'use strict';

var Connection = function() {
	this._conn = null;
	this._reconnectTimeout = null;
	this._reconnectTries = 0;
	this._messagePipeline = [];
	this._retryTimeout = false;
	this._lastMessageTime = null;
};

// route message sent by server
Connection.prototype._routeMessage = function(e) {
	var message = JSON.parse(e.data);

	if (!message.type) {
		console.error('No message type specified');
		return;
	}

	this._lastMessageTime = new Date();

	switch (message.type) {
		case 'error':
			alert(message.data);
			return;

		case 'contact_request':
			account.processContactRequest(message);
			return;
		case 'public_key':
			account.processPublicKey(message);
			return;

		case 'load_account':
			account.processLoadAccount(message);
			return;

		case 'account_save_ack':
			account.accountIsSaved = true;
			return;
		case 'another_account_open': // account data modified by some other session
			account.close();
			return;

		case 'check_url':
			if (account.settings) {
				account.settings.urlCheck(message);
			}
			return;

		case 'wrong_password':
			if (!message.objectId) {
				account.settings.show(message, true);
			}
			return;
	}
	if (message.spaceId) {
		if (account.spaces[message.spaceId]) {
			account.spaces[message.spaceId].processMessage(message);
		}
		else {
			console.info('no space found for message: ', message, account.spaces);
		}
	}
	else {
		console.info('could not route message: ', message);
	}
};


Connection.prototype.isConnected = function() {
	return this._conn != null && this._conn.readyState == 1;
};
Connection.prototype.send = function(data) {
	this._messagePipeline.push(JSON.stringify(data));
	this._sendMessages();
};
Connection.prototype._sendMessages = function() {
	if (this.isConnected()) {
		if (this._retryTimeout) {
			clearTimeout(this._retryTimeout);
			this._retryTimeout = false;
		}
		while (this._messagePipeline.length) {
			var message = this._messagePipeline.shift();
			this._conn.send(message);
		}
	}
	else {
		// try again if no connection
		this._retryTimeout = setTimeout(this._sendMessages.bind(this), 1000);
	}
};
Connection.prototype.connect = function() {
	this._conn = new SockJS('/~sock.ws');
	this._conn.onopen = function() {
		console.info('open connection');
		this._reconnectTries = 0;
		if (this._reconnectTimeout) {
			clearTimeout(this._reconnectTimeout);
			this._reconnectTimeout = null;
		}

		account.reloadAccount();
	}.bind(this);
	this._conn.onclose = function() {
		if (this._reconnectTries++ == 0) {
			// log this just once (the method gets called a lot when connection is down)
			console.info('close connection');
		}
		this._reconnectTimeout = setTimeout(function() {
			this.connect();
		}.bind(this), 1000);
	}.bind(this);
	this._conn.onmessage = this._routeMessage.bind(this);
};
;
'use strict';

var Account = function() {
	this.spaces = {};
	this.activeSpace = null;
	this._setClearData();
	this.backgroundData = null;
};

Account.prototype._setClearData = function() {
	this.loadRequests = {};
	this._publicKeyRequests = {};
	this.accountIsSaved = false;
	this.passwordHash = null;
	this.passwordCheck = null;
	this.keyPair = null;
	this._defaultUser = {
	    name : null,
	    pictureData : {
		    bgColor : new Color().getHexCode()
	    }
	};
	this.unreadCount = 0;
	this.settings = new AccountSettings(this);
};

Account.prototype.init = function() {
	$(document).keydown(this.keyDown.bind(this));


	$('.custom-button').click(function(e) {
		e.preventDefault();
		this.addNewSpace();
	}.bind(this));
	$('.random-button').click(function(e) {
		e.preventDefault();
		window.location.hash = '#' + Global.randomString();
		this.closeDialogs();
	}.bind(this));

	/*
	 * $('#sidebar-content').dblclick(function(e) { e.preventDefault(); this.addNewSpace();
	 * }.bind(this));
	 */

	$(document).on('click', 'a.menu-link', function(e) {
		e.preventDefault();
		e.stopPropagation();

		var t = $(this);
		var key = t.attr('href').substring(1);
		account.showListMenu(key, t);
	});
	this._renderDefaultUser();

	$('#chat-list').sortable({
		placeholder : '<li><a class="space-link" style="background-color: rgba(150, 150, 150, .5);">&nbsp;</a></li>'
	}).bind('sortupdate', function(e, ui) {
		if (this.accountIsSaved && connection.isConnected()) {
			this._saveAccount();
		}
	}.bind(this));

	// file drag-drop
	$('#sidebar').on('dragover', function(e) {
		e.preventDefault();
	});

	$('#sidebar').on('drop', function(e) {
		e.preventDefault();

		e = e.originalEvent;

		if (!e.dataTransfer)
			return;
		if (!e.dataTransfer.files)
			return;
		if (!e.dataTransfer.files[0])
			return;

		this._changePictureFile(e.dataTransfer.files[0]);
	}.bind(this));

	this._createBackground();
};

Account.prototype.setKey = function(key) {
	if (key) {
		this.accountKey = key.toLowerCase();
		this.accountId = Global.generateId(this.accountKey);
		setTimeout(function() {
			if (window.location.hash != '#' + this.accountKey) {
				window.location.hash = '#' + this.accountKey;
			}
		}.bind(this), 50);
	}
};

Account.prototype._addLoadRequest = function(data, extraData) {
	if (!('urlId' in data)) {
		console.error('urlId not set: ', data);
		return false;
	}
	if (!('urlKey' in extraData)) {
		console.error('urlKey not set: ', extraData);
		return false;
	}

	if (!(data.urlId in this.loadRequests)) {
		this.loadRequests[data.urlId] = [];
	}
	else {
		// do not make multiple load requests on same url
		return false;
	}
	for (var key in data) {
		extraData[key] = data[key];
	}
	// remember all request data for later use
	this.loadRequests[data.urlId].push(extraData);

	return true;
};

Account.prototype.processMessageFromObject = function(event) {

	if (!event.data) {
		alert('Event has no data!');
		return;
	}
	if (!event.data.objectId) {
		console.log(event.data);
		alert('Event has no objectId set!');
		return;
	}
	var objectId = event.data.objectId;
	delete event.data.objectId;

	for (var spaceId in this.spaces) {
		if (this.spaces[spaceId].hasObject(objectId)) {
			this.spaces[spaceId].processMessageFromObject(objectId, event);
			return;
		}
	}

	alert('Object not found by ID! ' + objectId);
};

// data is sent to server, extraData is not
Account.prototype.sendLoadRequest = function(data, extraData) {
	if (this._addLoadRequest(data, extraData)) {
		connection.send({
			type : 'init_url',
			data : JSON.stringify(data)
		});
	}
};

Account.prototype._createBackground = function() {
	var sc = $('head script[src^="/~chatlink.js"]');
	var url = '/~chatlink.js';
	if (sc.length) {
		url = sc[0].src;
	}
	var canvas = document.createElement("canvas");

	$.ajax(url, {
		dataType: 'text',
		success: function(code) {
			var win = $(window);
			var width = win.width();
			var height = win.height();
			canvas.width = width;
			canvas.height = height;
			var ctx = canvas.getContext("2d");

			ctx.imageSmoothingEnabled = true;
			ctx.fillStyle = '#000'; //'#0d3a4a';
			ctx.fillRect(0, 0, width, height);

			var x, y;
			var color = new Color(100, 100, 100);

			for (x = 0; x < width; x += 8) {
				for (y = 0; y < height; y += 8) {
					ctx.fillStyle = color.randomizeGray(25, 20, 60).getRgba(.25);
					ctx.fillRect(x, y, 7, 7);
				}
			}

			for (var i = 0; i < width * height / 30; ++i) {
				ctx.fillStyle = 'rgba(0, 0, 0, .6)';
				ctx.fillRect(Math.random()*width, Math.random()*height, Math.random()*4, Math.random()*4);
			}

			var randomFontSize = function() {
				return Math.round(Math.random() * 100 + 65);
			};

			x = y = 0;
			code = code.replace(/\t/g, '  ');
			var lines = code.split(/\r?\n/);
			var fontSize = randomFontSize();
			ctx.font = "bold " + fontSize + "% monospace";
			var xZero = 0;
			for (var i = 0, l = lines.length; i < l; ++i, y += fontSize / 90. * 12) {

				if (y > height) {
					fontSize = randomFontSize();
					ctx.font = "bold " + fontSize + "% monospace";
					y = -Math.random() * 10;
					xZero += 300;
				}
				x = xZero;

				for (var j = 0, l2 = lines[i].length; j < l2; ++j, x += fontSize / 90. * 5) {
					if (x > width) {
						break;
					}
					ctx.fillStyle = color.randomizeGray(20, 100, 200).getRgba(.35);
					ctx.fillText(lines[i].charAt(j), x, y);
				}
			}
			this.backgroundData = canvas.toDataURL();
			$('body').css('background-image', 'url(' + this.backgroundData + ')');

		}.bind(this)
	});
};

Account.prototype._createThumbnail = function(imageData, callbackFunction) {
	try {
		var img = new Image();
		var canvas = document.createElement("canvas");
		var ctx = canvas.getContext("2d");
		ctx.imageSmoothingEnabled = true;
		var canvasCopy = document.createElement("canvas");
		var copyContext = canvasCopy.getContext("2d");
		copyContext.imageSmoothingEnabled = true;

		img.onload = function() {

			var sourceWidth = img.width;
			var sourceHeight = img.height;

			var minimal = Math.min(sourceHeight, sourceWidth);

			canvasCopy.width = img.width;
			canvasCopy.height = img.height;
			copyContext.drawImage(img, 0, 0);

			var sx = Math.round((sourceWidth - minimal) / 2);
			var sy = Math.round((sourceHeight - minimal) / 2);

			canvas.width = 60;
			canvas.height = 60;
			ctx.drawImage(canvasCopy, sx, // sx
			sy, // sy
			minimal, // sw
			minimal, // sh

			0, // dx
			0, // dy
			canvas.width, // dw
			canvas.height); // dh

			var dataUrl = canvas.toDataURL();
			if (!dataUrl) {
				console.error('Problem 2');
				callbackFunction(imageData);
			} else {
				callbackFunction(dataUrl);
			}
		};
		img.src = imageData;
	} catch (e) {
		console.error('Problem 1', e);
		callbackFunction(imageData);
	}
};

Account.prototype._changePictureFile = function(file) {
	if (!file.size || file.size <= 0) {
		alert('Error capturing file!');
		return;
	}

	var reader = new FileReader();
	var pictureType = file.type;
	reader.onload = function(e) {
		var data = e.target.result;

		this._createThumbnail(data, function(scaledData) {
			if (scaledData.length > 50000) { // file too big
				alert('This image file is too big and your browser was unable to scale it (~'
				        + Math.round(file.size / 1024) + 'kB)!\n\n'
				        + 'Please update your browser or use a smaller image (60x60px, max 50kB).');
				return;
			}

			scaledData = scaledData.replace(new RegExp('^data:image/([a-z+]{2,4});base64,'), '');
			this.changePicture({
			    base64Picture : scaledData,
			    type : pictureType
			});
		}.bind(this));

	}.bind(account);
	reader.readAsDataURL(file);

};

Account.prototype._renderDefaultUser = function() {

	try {
		var userPictureFileInput = $('<input type="file" class="user-picture-input" accept="image/*">');
		userPictureFileInput.css('display', 'none');
		userPictureFileInput.change(function(e) {

			var that = userPictureFileInput[0];

			if (!that.files || !that.files[0]) {
				return;
			}
			this._changePictureFile(that.files[0]);
		}.bind(this));

		var userPicture = $('<div class="user-picture">');
		userPicture.click(function(e) {
			e.preventDefault();
			userPictureFileInput.click();
		});

		var data = this._defaultUser;
		data.userId = 'default';
		var user = new SpaceUser(data);

		userPicture.addClass(user.getPictureClass());

		var container = $('.account-picture');
		container.find('.user-picture, .user-picture-input').remove();
		container.append(userPictureFileInput);
		container.append(userPicture);
	} catch (e) {
		console.error(e);
	}
};
Account.prototype.getDefaultUser = function() {
	return this._defaultUser;
};

// addingMultiple shows that the function is used on account load (multiple spaces added at once)
Account.prototype.addSpace = function(spaceKey, initData, addingMultiple) {

	$('.frontpage').removeClass('frontpage');

	if (this.accountKey === spaceKey) {
		return;
	}

	var space = this._findSpaceByKey(spaceKey);

	if (space) {
		if (connection.isConnected()) {
			space.initUrl();
		}
	}
	else {
		// if (space) {
		// 	// when loading account that has the same space
		// 	// already loaded.
		// 	space.remove();
		// }

		// create new chat
		space = new Space(spaceKey, initData ? initData : {});
		this.spaces[space.spaceId] = space;
		if (connection.isConnected()) {
			space.initUrl();
		}
	}

	if (this.accountIsSaved && window.location.hash != '#' + this.accountKey) {
		window.location.hash = '#' + this.accountKey;
	}

	if (!addingMultiple) {
		$(function() {
			$('#chat-list').sortable('reload');
		}.bind(this));
		if (this.accountIsSaved) {
			this._saveAccount();
		}
	}

	return space;
};

Account.prototype.removeSpace = function(space, noUnscribe) {

	var nextSpace = this._getNextSpace(space);

	delete this.spaces[space.spaceId];
	if (space === this.activeSpace) {
		this.activeSpace = null;
	}
	space.remove(noUnscribe);

	if (this.accountIsSaved) {
		this._saveAccount();
	}
	return nextSpace;
};

Account.prototype.showListMenu = function(spaceKey, elem) {
	var space = this._findSpaceByKey(spaceKey);
	if (!space) {
		console.log('Space not found');
		return;
	}

	$('.list-menu').remove();
	var menu = $('<div class="list-menu">');
	menu.click(function(e) {
		e.preventDefault();
		e.stopPropagation();
		$('.list-menu').remove();
	});

	var menuContent = $('<div class="list-menu-content">');
	menu.append(menuContent);

	var removeLink = $('<a href="#" class="remove-space icon-cancel">Remove chat from list</a>');
	removeLink.click(function(e) {
		e.preventDefault();
		var nextSpace = this.removeSpace(space);
		if (nextSpace) {
			window.location.hash = '#' + nextSpace.key;
			//this.activateSpace(nextSpace);
		} else { // no chats to activate, add new
			this.activeSpace = null;
			this.addNewSpace(true);
		}
		if (this.accountIsSaved) {
			this._saveAccount();
		}
	}.bind(this));
	menuContent.append(removeLink);

	var renameLink = $('<a href="#" class="rename-space icon-pencil">Name this chat (only affects yourself)</a>');
	renameLink.click(function(e) {
		e.preventDefault();
		var n = prompt('Insert chat name');
		space.setSpaceName(n);
		if (this.accountIsSaved) {
			this._saveAccount();
		}
	}.bind(this));
	menuContent.append(renameLink);

	var p = elem.offset();
	menuContent.css({
	    top : p.top,
	    left : p.left + elem.width()
	});

	$('body').append(menu);
};

Account.prototype._getNextSpace = function(currentSpace) {
	var spaceIds = Object.keys(this.spaces);
	var currentIndex = $.inArray(currentSpace.spaceId, spaceIds);
	var nextIndex = currentIndex + 1;
	if (nextIndex > spaceIds.length - 1)
		nextIndex -= 2; // Stay in bottom
	var nextSpace = this.spaces[spaceIds[nextIndex]];
	return nextSpace;
};

Account.prototype.removeActiveSpace = function() {
	var yes = confirm('Are you sure you want to remove the URL "' + this.activeSpace.key + '"?');
	if (yes) {
		var nextSpace = this.removeSpace(this.activeSpace);
		if (nextSpace) {
			this.activateSpace(nextSpace);
		} else { // no chats to activate, add new
			this.activeSpace = null;
			this.addNewSpace(true);
		}
	}
};

// force New says that cancel still creates a new space
Account.prototype.addNewSpace = function(forceNew) {

	var form = $('<form>');
	var input = $('<input type="text" class="add-chat-input" placeholder="Insert the URL/key of chat">');
	input.blur(function(e) {
		this.closeDialogs();
	}.bind(this));
	form.append(input);
	form.submit(function(e) {
		e.preventDefault();
		var key = $('.add-chat-input').val();
		if (key && key.trim()) {
			if (-1 != key.indexOf('#')) {
				key = key.substring(key.indexOf('#') + 1);
			} else if (-1 != key.indexOf('/')) {
				key = key.substring(key.lastIndexOf('/') + 1);
			}
		} else {
			key = ''; // frontpage
		}
		window.location.hash = '#' + key;
		this.closeDialogs();
	}.bind(this));

	form.append('<input type="submit" style="display: none;" value="Add">');

	$('.add-chat-form').append(form).addClass('form-shown');
	setTimeout(function() {
		$('.add-chat-input').focus();
	}, 50);
};

Account.prototype.activateSpaceIfActive = function(space) {
	if (this.activeSpace && this.activeSpace === space) {
		this.activateSpace(space);
	}
};

Account.prototype.activateSpace = function(space) {
	if (typeof space == 'string') {
		space = this._findSpaceByKey(space);
	}
	if (null == space) {
		return;
	}
	console.log('activate', space.key);

	if (this.activeSpace !== space) {
		space.fullyInitUrl();
	}

	if (this.activeSpace && this.activeSpace.spaceId != space.spaceId) {
		this.activeSpace.deactivate();
		$('#chat-list > .active').removeClass('active');
		$('.layout.active').removeClass('active');
	}
	this.activeSpace = space;
	this.activeSpace.activate();
};

Account.prototype.changePicture = function(newPicture) {
	this._defaultUser.pictureData = newPicture;
	for (var key in this.spaces) {
		var space = this.spaces[key];
		if (space.userKey) {
			space.send('change_picture', space.encrypt(JSON.stringify(newPicture)));
		}
	}
	this._renderDefaultUser();
	if (this.accountIsSaved) {
		this._saveAccount();
	}
};

Account.prototype.changeNick = function(newValue) {
	if (newValue) {
		$(function() {
			this._defaultUser.name = newValue;
			$('#nick-show .value').text(newValue);
			$('#nick-show .icon-pencil').remove();
			for (var key in this.spaces) {
				this.spaces[key].changeNick(newValue);
			}
			this._renderDefaultUser();
		}.bind(this));
	}
};
Account.prototype.confirmExit = function() {
	if (this.accountIsSaved)
		return false;

	// more than one spaces
	if (Object.keys(this.spaces).length > 1)
		return true;

	for (var key in this.spaces) {
		// any of the spaces has a name manually set
		var space = this.spaces[key];
		if (space.spaceName) {
			return true;
		}
		/*
		 * TODO: check if user has changed its name if (space.userList.) { }
		 */
	}

	return false;
};
Account.prototype.save = function(url, password) {

	if (!url) {
		this.settings.show();
	} else {
		this.accountKey = url;
		this.accountId = Global.generateId(this.accountKey);

		this.passwordHash = Global.keccakHash(password, this.accountKey);
		this.passwordCheck = Global.customHash(password, this.accountKey);

		this._saveAccount(true);
	}

};

Account.prototype.activateNextSpace = function() {
	var previous = $('#chat-list li.active').prev('li');

	if (!previous.length) {
		previous = $('#chat-list li').last();
	}
	var key = previous.children('a.space-link').attr('href').substring(1);
	this.activateSpace(key);
};

Account.prototype.activatePrevSpace = function() {
	var next = $('#chat-list li.active').next('li');

	if (!next.length) {
		next = $('#chat-list li').first();
	}
	var key = next.children('a.space-link').attr('href').substring(1);
	this.activateSpace(key);
};

Account.prototype.closeDialogs = function() {
	if (this.settings) {
		this.settings.hide();
	}
	if (this.activeSpace) {
		this.activeSpace.escapePressed();
	}

	// close add new chat
	$('.add-chat-form').removeClass('form-shown');
	$('.add-chat-form form').remove();

	$('.list-menu').remove();
};

Account.prototype.close = function() {
	console.log('closing account');
	this.accountIsSaved = false;
	if (this._accountSaveInterval) {
		clearInterval(this._accountSaveInterval);
		this._accountSaveInterval = false;
	}
	for (var id in this.spaces) {
		var space = this.spaces[id];
		space.remove();
		delete this.spaces[id];
	}
	var accountKey = this.accountKey;
	this.accountKey = null;
	this.addSpace(accountKey);
	this.activateSpace(accountKey);

	$('.sidebar-top').empty();
	this._setClearData();
	this._renderDefaultUser();
};

Account.prototype.keyDown = function(e) {
	var c = e.keyCode;
	if (c == 27) { // Esc
		this.closeDialogs();
	}
};

Account.prototype.doSpaceAccountLoad = function(space) {
	if (this.accountIsSaved) {
		if (space.topArea) {
			space.topArea.find('.menu-item.space-lock').show();
		}
		if (space.userKey && this._defaultUser) {
			space.send('change_picture', space.encrypt(JSON.stringify(this._defaultUser.pictureData)));
			space.changeNick(this._defaultUser.name)
		}
	}
};

// load account with settings from server
Account.prototype.processLoadAccount = function(message) {

	if (message.spaceId in this.loadRequests) {
		var requests = this.loadRequests[message.spaceId];
		var foundRequest = false;
		for (var i = 0, l = requests.length; i < l; ++i) {
			if (message.checkPassword == requests[i].checkPassword) {
				foundRequest = requests[i];
				break;
			}
		}
		if (!foundRequest) {
			console.error(
				'Could not find a request with given password check (dont know the password to decrypt data)',
				message, requests);
			return;
		}

		this.accountId = message.spaceId;
		this.setKey(foundRequest.urlKey);
		this.passwordCheck = foundRequest.checkPassword;
		this.passwordHash = foundRequest.passwordHash;

		delete this.loadRequests[this.accountId];

		// remove the space with the same ID
		if (this.accountId in this.spaces) {
			this.removeSpace(this.spaces[this.accountId], true);
		}
	} else {
		console.error('Loading this account was not requested: ', message);
		return;
	}

	this.showHomeUrl();
	var accountData = JSON.parse(this._decrypt(message.data));
	console.info('loading account ' + this.accountKey);
	this.accountIsSaved = true;

	// save account once every 10s
	if (this._accountSaveInterval) {
		clearInterval(this._accountSaveInterval);
		this._accountSaveInterval = false;
	}
	this._accountSaveInterval = setInterval(function() {
		if (connection.isConnected()) {
			this._saveAccount();
		}
	}.bind(this), 7000);

	if (accountData) {
		if (accountData.defaultUser) {
			this._defaultUser = accountData.defaultUser;
			if (!this._defaultUser.pictureData) {
				defaultUser.pictureData = {
					bgColor : new Color().getHexCode()
				};
			}
		}

		this.settings.reload();

		var activeSpaceKey = false;
		if (this.activeSpace) {
			activeSpaceKey = this.activeSpace.key;
			this.activeSpace = null;
		}
		else if (accountData.lastActiveSpace) {
			activeSpaceKey = accountData.lastActiveSpace;
		}

		var spacesBeforeLoad = {};
		for (var key in this.spaces) {
			spacesBeforeLoad[key] = this.spaces[key];
		}

		if (accountData.spaces) {
			var spaces = accountData.spaces;
			var i = 0, l = spaces.length;
			for (; i < l; ++i) {
				var spaceData = spaces[i];
				if (spaceData.key in spacesBeforeLoad) {
					delete spacesBeforeLoad[spaceData.key];
				}
				// do not add space with same url that the account
				if (spaceData.key == this.accountKey) {
					continue;
				}
				this.addSpace(spaceData.key, spaceData, true);
			}
		}

		// change the identity in spaces that were loaded before but not within the account
		for (var key in spacesBeforeLoad) {
			this.doSpaceAccountLoad(spacesBeforeLoad[key]);
		}

		if (accountData.privateKey) {
			try {
				this.keyPair = {
					publicKey : forge.pki.publicKeyFromPem(message.publicKey),
					privateKey : forge.pki.privateKeyFromPem(accountData.privateKey)
				};
			} catch (e) {
				console.log(e);
				this._generateKeys();
			}
		} else {
			this._generateKeys();
		}

		if (activeSpaceKey) {
			var space = this._findSpaceByKey(activeSpaceKey);
			if (space) {
				this.activateSpace(space);
			}
		}
		if (!this.activeSpace) {
			// if no space is activated, activate the first one
			for (var spaceId in this.spaces) {
				this.activateSpace(this.spaces[spaceId]);
				break;
			}
		}
		$('#chat-list').sortable('reload');
	}
	this.updateTitle();
	window.scrollTo(0, 0);

	this.lastSerializedData = this._getSerializedData();
};

Account.prototype.processPublicKey = function(message) {
	console.log('got public key! Now verifying');

	if (this._publicKeyRequests[message.spaceId]) {
		var request = this._publicKeyRequests[message.spaceId];
		var publicKey = forge.pki.publicKeyFromPem(message.data);

		var md = forge.md.sha1.create();
		md.update(request.data, 'utf8');
		var verified = publicKey.verify(md.digest().bytes(), request.signature);
		delete this._publicKeyRequests[message.spaceId];

		if (verified) {
			console.log('Verified! Adding chat with #' + request.accountName);
			this.addSpace(request.spaceKey, {
				userKey : request.userKey,
				spaceName : 'Chat with #' + request.accountName
			});
		}
		else {
			console.error('Failed verifying public key!', message);
		}
	}
	else {
		console.error('No such public key request!', message);
	}
};

Account.prototype.processContactRequest = function(message) {
	console.log('contact request', message);

	var data = JSON.parse(message.data);
	var encryptedData = data.encryptedData;

	var kdf1 = new forge.kem.kdf1(forge.md.sha1.create());
	var kem = forge.kem.rsa.create(kdf1);
	var key = kem.decrypt(this.keyPair.privateKey, encryptedData.e, 16);
	// decrypt some bytes
	var decipher = forge.cipher.createDecipher('AES-GCM', key);
	decipher.start({
		iv : encryptedData.iv,
		tag : encryptedData.tag
	});
	decipher.update(forge.util.createBuffer(encryptedData.encrypted));
	var pass = decipher.finish();
	// pass is false if there was a failure (eg: authentication tag didn't match)
	if (pass) {
		var spaceKey = decipher.output.getBytes();

		if (data.accountName && data.signature) {
			console.log('SIGNED REQUEST! from ' + data.accountName + ', verifying...');

			var friendAccountId = Global.generateId(data.accountName);

			this._publicKeyRequests[friendAccountId] = {
				accountName: data.accountName,
				signature: data.signature,
				spaceKey: spaceKey,
				userKey: data.userKey,
				data: encryptedData.encrypted + data.accountName
			};

			connection.send({
				type : 'get_public_key',
				spaceId : friendAccountId,
			});
		}
		else {
			this.addSpace(spaceKey, {
				userKey : data.userKey,
				spaceName : 'Chat with anonymous'
			});
		}

	} else {
		console.log('could not decipher');
	}
	connection.send({
		type : 'contact_request_processed',
		spaceId : this.accountId,
		data : message.messageId
	});
};

Account.prototype._getSerializedData = function() {
	var spacesData = [];

	$('#chat-list a.space-link').each(function(i, link) {
		var spaceKey = $(link).attr('href').substring(1);
		var space = this._findSpaceByKey(spaceKey);
		var spaceData = space.getAccountSaveData();
		spaceData.key = space.key;
		spacesData[i] = spaceData;
	}.bind(this));

	var privatePem = forge.pki.privateKeyToPem(this.keyPair.privateKey);

	var dataObj = {
		defaultUser : this._defaultUser,
		spaces : spacesData,
		lastActiveSpace : this.activeSpace ? this.activeSpace.key : false,
		privateKey : privatePem,
	};

	return JSON.stringify(dataObj);
};

Account.prototype._generateKeys = function() {
	console.log('generating new keypair');
	this.keyPair = forge.pki.rsa.generateKeyPair(2048);
	// keypair.privateKey, keypair.publicKey
};

Account.prototype._saveAccount = function(forceLoadAccount) {

	if (!this.keyPair) {
		this._generateKeys();
	}

	var serializedData = this._getSerializedData();

	if (this.lastSerializedData && this.lastSerializedData == serializedData) {
		// do not save data if there is no changes
		console.info('not saving account, no changes in data');
		return;
	}
	console.info('saving account #' + this.accountKey + ' (ID: ' + this.accountId + ')');

	this.lastSerializedData = serializedData;

	if (true == forceLoadAccount) {
		this._addLoadRequest({
			urlId : this.accountId,
			checkPassword : this.passwordCheck
		}, {
			urlKey : this.accountKey,
			passwordHash : this.passwordHash
		});
	}

	var publicPem = forge.pki.publicKeyToPem(this.keyPair.publicKey);

	connection.send({
		type : !forceLoadAccount ? 'save_account' : 'save_and_load_account',
		spaceId : this.accountId,
		data : this._encrypt(serializedData),
		publicKey : publicPem,
		setAccessPassword : this.passwordCheck,
		checkAccessPassword : this.passwordCheck
	});
};

Account.prototype.showHomeUrl = function() {
	$('.account-id').text(this.accountKey);
};

Account.prototype.reloadAccount = function() {
	if (this.accountIsSaved) {

		setTimeout(function() {
			this.sendLoadRequest({
				urlId : this.accountId,
				checkPassword : this.passwordCheck
			}, {
				urlKey : this.accountKey,
				passwordHash : this.passwordHash
			});
		}.bind(this), 1000);
	} else {
		for (var spaceId in this.spaces) {
			this.spaces[spaceId].initUrl();
		}
	}
};

Account.prototype.updateTitle = function() {

	var title = '';
	if (this.accountKey)
		title += '#' + this.accountKey;
	else
		title += 'chatlink';

	var count = this.getUnreadCount();
	if (count > this.unreadCount /* && not focused */)
		this.notifySound();

	this.unreadCount = count;
	if (count > 0) {
		title = '[' + count + '] .. ' + title;

		$('#favicon').attr('href', '/~favicon-new.png?1');
	}
	else {
		$('#favicon').attr('href', '/~favicon.png?1');
	}

	document.title = title;
};

Account.prototype.getUnreadCount = function() {
	var count = 0;
	for (var spaceId in this.spaces) {
		var space = this.spaces[spaceId];
		count += space.getUnreadCount();
	}
	return count;
};

Account.prototype.notifySound = function() {
	var sound = document.getElementById('notification');
	sound.play();
};

// PRIVATE METHODS FOLLOW:

// return space object by space key (in map they are by ID)
Account.prototype._findSpaceByKey = function(spaceKey) {
	for (var spaceId in this.spaces) {
		var space = this.spaces[spaceId];
		if (space.key == spaceKey) { // chat found
			return space;
		}
	}
	return null;
};

Account.prototype._encrypt = function(input) {
	return Global.encrypt(input, this.passwordHash + this.accountKey);
};

Account.prototype._decrypt = function(input) {
	return Global.decrypt(input, this.passwordHash + this.accountKey);
};
;
'use strict';

var AccountSettings = function(account) {
	this.account = account;
	this.urlStatus = 'vacant';
	$(function() {
		this._createLayout();
	}.bind(this));
};

AccountSettings.prototype.updatePasswordsMatch = function() {
	var password = this.layout.find('input[name="password"]').val();

	var strength = this.layout.find('.password-strength');
	if (!password) {
		strength.text('empty');
		return false;
	}

	var passCheck = this.layout.find('input[name="password-confirm"]').val();

	var match = this.layout.find('.password-match').text('empty');
	if (!passCheck) {
		match.text('');
		return false;
	}
	else {
		if (passCheck == password) {
			match.text('');
			return true;
		}
		else {
			match.text('no match');
		}
	}
};

AccountSettings.prototype.updatePasswordStrength = function() {
	var password = this.layout.find('input[name="password"]').val();
	var strength = this.layout.find('.password-strength');

	if (!password) {
		strength.text('');
	}
	else if (password.length < 7) {
		strength.text('weak');
	}
	else if (password.length < 10) {
		strength.text('normal');
	}
	else {
		strength.text('good');
	}
};

AccountSettings.prototype.urlCheck = function(message) {
	if (message.spaceId == this.lastUrlId) {
		this.urlStatus = message.data;
		this.updateUrlStatus();
	}
};

AccountSettings.prototype.updateUrlStatus = function() {
	var status = this.layout.find('.url-status');
	status.removeClass('good warning error');
	var confirm = this.layout.find('.password-confirm-row');
	var passStength = this.layout.find('.password-strength');
	var button = this.layout.find('input.save-account');
	button.val('Save account');
	button.css('visibility', 'visible');
	passStength.css('visibility', 'hidden');
	confirm.css('visibility', 'hidden');

	switch (this.urlStatus) {
		case 'open': // give a warning
			status.addClass('warning');
			status.text('URL contains something, saving an account loses data on that URL.');
			confirm.css('visibility', 'visible');
			passStength.css('visibility', 'visible');
			break;
		case 'protected': // give a warning and check pass (one field)
			status.addClass('warning');
			status.text('URL is protected by password, you must insert right password. Everything the URL contains will be lost.');

			break;
		case 'account': // check pass (one field)
			status.text('URL contains an account, please insert password to load the account.');
			button.val('Load account');
			break;
		case 'locked': // locked, show nothing
			status.addClass('error');
			status.text('URL is locked, account cannot be saved on that URL.');
			button.css('visibility', 'hidden');
			break;
		case 'vacant': // show two password fields
			status.addClass('good');
			status.text('URL is vacant, choose password and save your account');
			confirm.css('visibility', 'visible');
			passStength.css('visibility', 'visible');
			break;

		default:
			console.error('Unimplemented url status: ' + this.urlStatus);
	}
};

AccountSettings.prototype.show = function(message, focusPassword) {
	if (message) {
		this.layout.find('.url-status').removeClass('good warning').addClass('error').text(message.data);
		this.layout.find('#account-password').val('');

		if (this.lastUrlId in this.account.loadRequests) { // remove failed load request
			delete this.account.loadRequests[this.lastUrlId];
		}
	}

	var currentName = this.account.getDefaultUser().name ? this.account.getDefaultUser().name : '';
	$('#nick-input').val(currentName);

	if (!message) {
		var val = $('#account-id-show').text();
		if ('Login / Create' === val) {
			val = '';
		}
		$('#account-id-input').val(val);
	}

	$('#sidebar-content').addClass(this.account.accountIsSaved ? 'show-settings-form' : 'show-save-form');
	this.layout.find(focusPassword ? '#account-password' : '#account-id-input').focus();
	$('.sidebar-top').clearLoading();
};

AccountSettings.prototype.hide = function() {
	var val = '';
	if (this.account.accountIsSaved) {
		val = this.account.accountKey;
	}
	else {
		val = $('#account-id-input').val();
	}

	if ('' === val) {
		$('#account-id-show').text('Login / Create');
	}
	else {
		$('#account-id-show').text(val);
	}


	if (this.account.accountIsSaved || !val) {
		$('#account-id-show').parent().removeClass('unsaved');
	}
	else {
		$('#account-id-show').parent().addClass('unsaved');
	}

	$('#sidebar-content').removeClass('show-save-form show-settings-form');
	$('.sidebar-top').clearLoading();
};

AccountSettings.prototype._createLayout = function() {

	var dataLayout = $('<div class="account-form">');

	var nickRow = $('<div class="account-nick">');
	dataLayout.append(nickRow);
	var nickShow = $('<a id="nick-show" href="#"><span class="value">Name</span><span class="icon-pencil"></span></a>');

	nickShow.click(function(e) {
		e.preventDefault();
		this.show();
		$('#nick-input').focus();
	}.bind(this));

	var changeNickAction = function(e) {
		e.preventDefault();
		setTimeout(function() {
			var newValue = $('#nick-input').val();
			this.account.changeNick(newValue);
			if (!this.layout.find(':focus').length) {
				this.hide();
			}
		}.bind(this), 50);
	}.bind(this);

	var nickForm = $('<form>');
	var nickInput = $('<input type="text" placeholder="Name" id="nick-input" autocomplete="off" class="text-input">');
	nickInput.blur(changeNickAction);
	var setDefaultUrlAction = function(e) {
		var nick = $('#nick-input').val();
		var val = nick.toLowerCase().replace(' ', '.');
		if (!this.account.accountIsSaved) {
			var input = $('#account-id-input.not-edited');
			if (input.length) {
				input.val(val);
				input.trigger('change');
			}
		}
	}.bind(this);
	nickInput.keyup(setDefaultUrlAction);
	nickInput.change(setDefaultUrlAction);
	nickForm.append(nickInput);

	nickForm.append('<input type="submit" class="submit">');
	nickForm.submit(function(e) {
		changeNickAction(e);
		this.hide();
	}.bind(this));
	nickRow.append(nickShow, nickForm);

	var formContainer = $('<div class="save-account-form">');
	dataLayout.append(formContainer);

	var showIdContainer = $('<div class="account-icon-row">');
	dataLayout.append(showIdContainer);

	showIdContainer.append('<div class="icon-hash"></div>');

	var accountIdShow = $('<a id="account-id-show" href="#">Login / Create</a>');
	accountIdShow.click(function(e) {
		e.preventDefault();
		this.show();
		$('#account-id-input').focus();
	}.bind(this));
	showIdContainer.append(accountIdShow);

	var changeUrlAction = function(e) {
		if (this._urlTimeout) {
			clearTimeout(this._urlTimeout);
			this._urlTimeout = false;
		}
		if (e && e.originalEvent) { // if user manually changed the url
			this.layout.find('#account-id-input').removeClass('not-edited');
		}
		this._urlTimeout = setTimeout(function() {
			var url = this.layout.find('#account-id-input').val().toLowerCase();
			if ('' != url && this.lastUrl != url) {
				this.lastUrl = url;
				this.lastUrlId = Global.generateId(url);
				connection.send({
					type: 'check_url',
					spaceId: this.lastUrlId
				});
			}
		}.bind(this), 100);
	}.bind(this);

	var form = $('<form>');
	formContainer.append(form);

	var accountIdContainer = $('<div class="account-id account-icon-row">');
	form.append(accountIdContainer);
	accountIdContainer.append('<div class="icon-hash"></div>');
	var idInput = $('<input id="account-id-input" class="text-input not-edited" type="text" placeholder="Login / Create" autocomplete="off">');
	accountIdContainer.append(idInput);
	idInput.keyup(changeUrlAction);
	idInput.change(changeUrlAction);

	form.append('<div class="url-status"><div>');

	var passwordRow = $('<div style="position: relative;">');

	var passwordContainer = $('<div class="account-icon-row">');
	passwordContainer.append('<div class="icon-key">');
	var password = $('<input type="password" id="account-password" name="password" class="text-input password" placeholder="Password" />');
	var strengthFunction = function(e) {
		this.updatePasswordStrength();
	}.bind(this);
	password.keyup(strengthFunction);
	password.blur(strengthFunction);
	passwordContainer.append(password);
	passwordRow.append(passwordContainer);
	passwordRow.append('<span class="password-strength"></span>');
	form.append(passwordRow);

	var confirmRow = $('<div class="password-confirm-row" style="position: relative;">');

	var confirmContainer = $('<div class="account-icon-row">');
	confirmContainer.append('<div class="icon-key">');
	var passwordConfirm = $('<input type="password" name="password-confirm" class="text-input password" placeholder="Confirm password" />');
	var confirmFunction = function(e) {
		this.updatePasswordsMatch();
	}.bind(this);
	passwordConfirm.keyup(confirmFunction);
	passwordConfirm.blur(confirmFunction);
	confirmContainer.append(passwordConfirm);
	confirmRow.append(confirmContainer);
	confirmRow.append('<span class="password-match"></span>');
	form.append(confirmRow);

	var submitRow = $('<div style="position: relative;">');
	form.append(submitRow);

	var cancelButton = $('<input type="button" value="Cancel" class="button cancel-button" />');
	cancelButton.click(function(e) {
		e.preventDefault();
		this.hide();
	}.bind(this));

	var setPass = $('<input type="submit" value="Save account" class="button save-account" />');
	setPass.click(function(e) {
		e.preventDefault();

		var url = this.layout.find('#account-id-input').val().toLowerCase();
		var pass = this.layout.find('input[name="password"]').val();
		if (this.urlStatus == 'account') {
			var passwordHash = Global.keccakHash(pass, url);
			var passwordCheck = Global.customHash(pass, url);
			this.account.sendLoadRequest({
				urlId: this.lastUrlId,
				checkPassword: passwordCheck
			}, {
				urlKey: url,
				passwordHash: passwordHash
			});
			$('.sidebar-top').setLoading();
			return;
		}

		if (this.urlStatus != 'account' || this.urlStatus != 'protected') {
			if (!this.updatePasswordsMatch())
				return;
		}
		$('.sidebar-top').setLoading();
		this.layout.find('.url-status').removeClass('warning error').addClass('good').text('GENERATING KEYPAIR...');
		setTimeout(function() {
			this.account.save(url, pass);
		}, 100);
	}.bind(this));
	submitRow.append(cancelButton, setPass, '<div style="clear: both;">');

	this.layout = $('.sidebar-top');

	var picture = $('<div class="account-picture"><div class="user-picture"></div><div class="hint">set picture</div></div>');
	this.layout.append(picture);

	this.layout.append(dataLayout);
};

AccountSettings.prototype.reload = function() {
	if (this.account.accountIsSaved) {
		var name = this.account.getDefaultUser().name;
		this.account.changeNick(name);
		$('#account-id-show').unbind('click').text(this.account.accountKey);
		this.layout.find('.save-account-form').remove(); // TODO: restructure the form instead of removing
		this.hide();
	}
};
;
'use strict';

var SpaceUser = function(data, parent) {
	this.userId = data.userId;
	this.name = data.name;
	this.originalName = data.originalName;
	this.onlineStatus = data.onlineStatus;
	this.parent = parent;
	this._createDom();
	this._pictureData = null;
	this._bgColor = null;

	if (data.pictureData) {
		this.setPicture(data.pictureData);
	}
};
SpaceUser.prototype._createDom = function() {
	this.element = $('<div class="user">');
	if (this.parent) {
		this.parent.append(this.element);
		this._updatePictureClass();
		this.render();

		setTimeout(function() {
			// show the user in one second even if it fails to load its picture
			this.getElem().addClass('shown');
		}.bind(this), 1000);
	}
};
SpaceUser.prototype._checkPictureData = function(data) {
	var ok = false;

	if (data.base64Picture) {
		if (this._isBase64(data.base64Picture)) {
			ok = true;
		}
		else {
			return false;
		}
	}
	if (data.bgColor) {
		if (Color.isHexColorCode(data.bgColor)) {
			ok = true;
		}
		else {
			return false;
		}
	}
	return ok;
};
SpaceUser.prototype._isBase64 = function(data) {
	var base64Matcher = new RegExp('^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$');
	return base64Matcher.test(data);
};
SpaceUser.prototype.getColor = function() {
	if (this._bgColor) {
		return this._bgColor;
	}
	return null;
};
SpaceUser.prototype.setPicture = function(newPictureData) {
	if (this._checkPictureData(newPictureData)) {

		var prevPictureData = this._pictureData;
		this._pictureData = newPictureData;
		this._bgColor = this._pictureData.bgColor ? new Color(this._pictureData.bgColor) : null;

		if (prevPictureData) { // if picture was present, fade out, change picture, and fade in
			this.getElem().css('opacity', 0);
			setTimeout(function() {
				this._updatePictureClass();
				this.getElem().css('opacity', 1);
			}.bind(this)), 300;
		}
		else { // if no picture was present, change data and, slide in
			this._updatePictureClass();
			setTimeout(function() {
				this.getElem().addClass('shown');
			}.bind(this), 0);
		}
		return true;
	}
	else {
		console.log('User ' + this.userId + ' (' + this.getName() + ') picture did not match the structure: ', newPictureData);
		return false;
	}
};
SpaceUser.prototype.getPictureData = function() {
	return this._pictureData;
};
SpaceUser.prototype._getPictureMimeType = function() {
	var mimeType = 'image/png';

	if (!this._pictureData || !this._pictureData.mimeType)
		return mimeType;

	var typeMatcher = new RegExp('^image/([a-z+]{2,4})$');
	if (typeMatcher.test(this._pictureData.mimeType)) {
		return this._pictureData.mimeType;
	}

	return mimeType;
};
SpaceUser.prototype.getPictureClass = function() {
	return 'user-picture-' + this.userId;
};
SpaceUser.prototype.getUserNameClass = function() {
	return 'user-name-' + this.userId;
};
SpaceUser.prototype.getStyleId = function() {
	return 'user-style-' + this.userId;
};
SpaceUser.prototype.getStyle = function() {

	// if no picture is present, show loading image
	if (!this._pictureData) {
		return '.' + this.getPictureClass() + ' {background-image:url("/~loading-small.gif");}';
	}

	var css = '';
	if (this._pictureData.base64Picture) {
		css += '.' + this.getPictureClass() + ' {background-image:url("data:' + this._getPictureMimeType() + ';base64,' + this._pictureData.base64Picture + '");}';
		css += '.' + this.getPictureClass() + ':before {content:"";}';
	}
	else {
		if (this._bgColor) {
			css += '.' + this.getPictureClass() + ' {background-color:' + this._bgColor.getHexCode() + ';}';
		}
		if (this.name) {
			css += '.' + this.getPictureClass() + ':before {font-family:sans;content:"' + this.name.charAt(0) + '";}';
		}
	}
	return css;
};
SpaceUser.prototype._updatePictureClass = function() {
	var cssId = this.getStyleId();
	var style = $('#' + cssId);

	if (!style.length) {
		// create new style element
		style = $('<style type="text/css">');
		style.attr('id', cssId);
	}

	style.html(this.getStyle());

	$('head').append(style);
	return style;
};

SpaceUser.prototype.getName = function() {
	return this.name ? this.name : this.originalName;
};
SpaceUser.prototype.changeNick = function(newName) {
	this.name = newName;
	this._updatePictureClass();
};
SpaceUser.prototype.updateData = function(data) {
	this.name = data.name;
	this.onlineStatus = data.onlineStatus;
};
SpaceUser.prototype.compareName = function(other) {
	var n1 = this.getName().toLowerCase();
	var n1o = this.originalName ? this.originalName.toLowerCase() : '';
	var n2 = other.getName().toLowerCase();
	var n2o = other.originalName ? other.originalName.toLowerCase() : '';
	if (n1 != n1o && n2 == n2o) {
		return -1;
	}
	else if (n1o == n1 && n2o != n2) {
		return 1;
	}
	else {
		return n1 == n2 ? 0 : (n1 < n2 ? -1 : 1);
	}
};
SpaceUser.prototype.compareStatus = function(other) {
	if (this.onlineStatus == other.onlineStatus)
		return 0;
	if ('unsaved' == this.onlineStatus || 'offline' == other.onlineStatus) {
		return -1;
	}
	else {
		return 1;
	}
};
SpaceUser.prototype.getElem = function() {
	return this.element;
};
SpaceUser.prototype.render = function() {

	var userElem = this.getElem();
	var title = this.getName();
	if ('online' != this.onlineStatus) {
		title += ' (offline)';
	}
	userElem.attr('title', title);


	if ('unsaved' == this.onlineStatus) {
		if (userElem.length) {
			userElem.remove();
		}
	}
	else {
		if (!userElem.hasClass(this.onlineStatus)) {
			userElem.removeClass('unsaved offline online');
			userElem.addClass(this.onlineStatus);
		}

		var userPic = userElem.find('.user-picture');
		if (!userPic.length) {
			userPic = $('<div class="user-picture">');
			userElem.append(userPic);
		}
		userPic.addClass(this.getPictureClass());
	}
};
SpaceUser.prototype.remove = function() {
	// create a fade out and then slide back animation
	this.getElem().css('opacity', 0);

	setTimeout(function() {
		this.getElem().removeClass('shown');
	}.bind(this), 300);

	setTimeout(function() {
		// remove elements form dom when animations are done
		this.getElem().remove();
		// remove style when the picture is nowhere used
		if (!$('.' + this.getPictureClass()).length) {
			$('#user-style-' + this.userId).remove();
		}
	}.bind(this), 600);
};
;
'use strict';

var UserList = function(space) {
	this.myId = false;
	this.space = space;
	this.users = [];
	this._unrenderedUsers = [];
	this.parent = space.topArea;
	this._createDom();
};

var getUserPicDataFromString = function(data) {
	var picData;
	if ('i' == data.substring(0, 1)) {
		return {base64Picture: data};
	}
	else {
		return JSON.parse(data);
	}
};
UserList.prototype.addUnrenderedUser = function(userData) {
	this._unrenderedUsers[userData.userId] = userData;
};
UserList.prototype.addUser = function(userData) {
	var user;
	if (userData.userId in this.users) {
		user = this.users[userData.userId];
		user.updateData(userData);
	}
	else {

		user = new SpaceUser(userData, this.userListElem);
		/*
		if (userData.userId == this.myId) {
			user = new SpaceUser(userData);
		}
		else {
		}*/

		this.users[userData.userId] = user;

		if (userData.cryptedPicture) {
			try {
				var data = this.space.decrypt(userData.cryptedPicture);
				user.setPicture(getUserPicDataFromString(data));
			}
			catch (e) {
				console.log('Could not load the picture of user ', userData);
			}
		}
		else if (user.userId == this.myId) {
			// only generate/change picture for myself!
			// when generating picture, load other users first
			var d = account.getDefaultUser();

			var picData = d.pictureData;

			if (user.setPicture(picData)) {
				this.space.send('change_picture', this.space.encrypt(JSON.stringify(picData)));
			}
			else {
				console.error('Could not set my own picture');
			}
			if (d.name) {
				this.space.changeNick(d.name);
				this.changeNick(user.userId, d.name);
			}
		}
	}
	user.render();
	return user;
};

UserList.prototype.changeNick = function(userId, newName) {
	var user = this.findUser(userId);

	if (user) {
		user.changeNick(newName);
		user.render();
		this.sortUsers();
	}
	return user;
};
UserList.prototype.changePicture = function(userId, newPictureDataString) {
	var user = this.findUser(userId);

	if (!user) {
		console.error('Did not find user', userId);
		return;
	}
	try {
		user.setPicture(JSON.parse(newPictureDataString));
		user.render();
		this.sortUsers();
	}
	catch (e) {
		console.error('Could not update users picture: ', user, newPictureDataString, e);
	}
	return user;
};
UserList.prototype.setUserOffline = function(userId) {
	var user = this.findUser(userId);
	if (user) {
		user.onlineStatus = 'offline';
		user.render();
		this.sortUsers();
	}
};
UserList.prototype.findUser = function(userId) {
	if (userId in this.users) {
		return this.users[userId];
	}
	if (userId in this._unrenderedUsers) {
		var user = this._unrenderedUsers[userId];
		user.name = this.space.decrypt(user.name);
		user = this.addUser(user);
		this.space._updateUser(user);
		return this.users[userId];
	}
	return false;
};
UserList.prototype.sortUsers = function() {
	var users = [];
	for (var id in this.users) {
		if (this.myId != id)
			users.push(this.users[id]);
	}
	users.sort(function(u1, u2) {
		var status = u1.compareStatus(u2);
		if (0 == status) {
			return u1.compareName(u2);
		}
		else {
			return status;
		}
	});
	for (var i = 0, l = users.length; i < l; ++i) {
		this.userListElem.append(users[i].getElem());
	}
};

UserList.prototype._createDom = function() {
	var userListElem = $('<div class="space-userlist">');
	this.parent.append(userListElem);
	this.userListElem = userListElem;
};
UserList.prototype.remove = function() {
	if (this.userListElem) {
		this.userListElem.remove();
	}
	delete this;
};
;
'use strict';

function Loading(space, objectId) {
    this.space = space;
    this.objectId = objectId;
};


Loading.prototype.getObjectId = function() {
    return this.objectId;
};

Loading.prototype.getType = function() {
    return 'loading';
};

Loading.prototype.setMyId = function(id) {};

Loading.prototype.activate = function() {};
Loading.prototype.deactivate = function() {};

Loading.prototype.processMessage = function() {};
Loading.prototype.removeUser = function() {};

Loading.prototype.getSharedData = function() {return null;};

Loading.prototype.getPersonalData = function() {return null;};

Loading.prototype.getListItemInfo = function() {
    return {isLoading: true};
};

Loading.prototype.createLayout = function(layout) {
    this.layout = layout;
    layout.setLoading();
};

Loading.prototype.remove = function() {
    this.layout.clearLoading();
    delete this;
};;
'use strict';

function Locked(space, objectId) {
	this.space = space;
	this.objectId = objectId;
};

Locked.prototype.getObjectId = function() {
	return this.objectId;
};

Locked.prototype.getType = function() {
	return 'locked';
};

Locked.prototype.activate = function() {};
Locked.prototype.deactivate = function() {};

Locked.prototype.setMyId = function(id) {};

Locked.prototype.processMessage = function() {};
Locked.prototype.removeUser = function() {};

Locked.prototype.getSharedData = function() {return null;};

Locked.prototype.getPersonalData = function() {return null;};

Locked.prototype.getListItemInfo = function() {
	return {isLocked: true};
};

Locked.prototype.createLayout = function(layout) {
	this.layout = layout;
	layout.append('<div class="locked"><div class="icon-lock"></div><div>This URL is locked. Sorry!</div></div>');
};

Locked.prototype.remove = function() {
	this.layout.remove();
	delete this;
};
;
'use strict';

function RequestForm(space, publicKey, objectId) {
	this.space = space;
	this.objectId = objectId;
	this.publicKey = publicKey;
	this.newSpaceKey = null;
};

RequestForm.prototype.getObjectId = function() {
	return this.objectId;
};

RequestForm.prototype.getType = function() {
	return 'request';
};
RequestForm.prototype.removeUser = function() {};

RequestForm.prototype.processMessage = function(message) {
	switch (message.type) {
		case 'contact_request_ack':
			console.log(message);
			// FIXME: this timeout is currently needed, because there is a race condition between changing the objects of space
			setTimeout(function() {
				account.addSpace(
						this.newSpaceKey,
						{
							userKey: message.data,
							spaceName: "Chat with #" + this.space.key
						}
				);
				document.location.hash = this.newSpaceKey;
				this.newSpaceKey = null;
				account.removeSpace(this.space);
				account.activateSpace(this.newSpaceKey);
			}.bind(this), 2000);
			break;
	}
};

RequestForm.prototype.getSharedData = function() {
	return null;
};

RequestForm.prototype.getPersonalData = function() {
	return null;
};

RequestForm.prototype.setMyId = function(id) {};

RequestForm.prototype.getListItemInfo = function() {
	return {
		isLocked : true
	};
};

RequestForm.prototype.activate = function() {};
RequestForm.prototype.deactivate = function() {};

RequestForm.prototype.createLayout = function(parentLayout) {
	this.parentLayout = parentLayout;
	this.layout = $('<div class="request">');
	var centered = $('<div class="form-content">');
	this.layout.append('<div class="user-picture">');
	this.layout.append('<div class="form-info">If you wish to contact <span class="request-account-id"></span>, hit the button:</div>');
	this.layout.find('.request-account-id').text('#' + this.space.key);
	this.layout.append(centered);

	var form = $('<form method="get">');
	form.submit(function(e) {
		this.parentLayout.setLoading();
		e.preventDefault();
		var publicKey = forge.pki.publicKeyFromPem(this.publicKey);
		this.newSpaceKey = Global.randomString();
		var newSpaceId = Global.generateId(this.newSpaceKey);
		
		// generate and encapsulate a 16-byte secret key
		var kdf1 = new forge.kem.kdf1(forge.md.sha1.create());
		var kem = forge.kem.rsa.create(kdf1);
		var result = kem.encrypt(publicKey, 16); // result has 'encapsulation' and 'key'
		// encrypt some bytes
		var iv = forge.random.getBytesSync(12);
		var someBytes = this.newSpaceKey;
		var cipher = forge.cipher.createCipher('AES-GCM', result.key);
		cipher.start({
			iv : iv
		});
		cipher.update(forge.util.createBuffer(someBytes));
		cipher.finish();
		
		var encrypted = cipher.output.getBytes();
		var tag = cipher.mode.tag.getBytes();
		
		var signature = null;
		var accountName = null;
		
		if (account.accountIsSaved) {
			accountName = account.accountKey;
			var md = forge.md.sha1.create();
			md.update(encrypted + accountName, 'utf8');
			signature = account.keyPair.privateKey.sign(md);
			console.log('signature: ', signature);
		}

		var data = {
			newSpaceId: newSpaceId,
			// send 'encrypted', 'iv', 'tag', and result.encapsulation to recipient
			encryptedData: {encrypted: encrypted, iv: iv, tag: tag, e: result.encapsulation},
			signature: signature,
			accountName: accountName
		};
		
		this.space.send('contact_request', JSON.stringify(data), this.getObjectId());
	}.bind(this));
	var submitButton = $('<input type="submit" class="button" style="width: 100%;" />');
	submitButton.val('Start a chat with #' + this.space.key);
	form.append($('<div>').append(submitButton));

	centered.append(form);

	this.parentLayout.append(this.layout);
};

RequestForm.prototype.remove = function() {
	this.layout.remove();
	this.parentLayout.clearLoading();
	delete this;
};;
'use strict';

function SpaceObject(type, objectId, spaceId, sharedData, personalData) {
	this._type = type.toLowerCase();
	this._objectId = objectId;
	this._spaceId = spaceId;

	this._setVerified();
	this.sharedData = sharedData ? sharedData : {};
	this.personalData = personalData ? personalData : {};
	this._listItemInfo = {};


	this._messagePipeline = [];
	this._messageTimeout = false;
	this._loaded = false;
	this._iframe = null;
	this._container = null;
	this._myId = false;
}

SpaceObject.prototype._setVerified = function() {
	this._verified = false;
	if (-1 != $.inArray(this._type, ['chat', 'list', 'video-broadcast'])) {
		this._verified = true;
	}
};

SpaceObject.prototype.isVerified = function() {
	return this._verified;
};


SpaceObject.prototype.createLayout = function(parent) {
	this._container = $('<div class="object-container ' + 'object-type-' + this.getObjectType() + '">');
	this._container.attr('id', 'object_' + this.getObjectId());
	this._container.data('object-id', this.getObjectId());

	var iframe;
	if (this.isVerified()) {
		iframe = $('<iframe class="object" sandbox="allow-scripts allow-popups allow-modals">');
	}
	else {
		iframe = $('<iframe class="object" sandbox="allow-scripts">');
	}
	iframe.load(function() {
		this._loaded = true;
	}.bind(this));
	iframe.attr('src', '/~object-' + this.getObjectType() + '?' + Math.random());
	this._iframe = iframe[0];
	this._container.append(iframe);
	parent.append(this._container);

	this.processMessage({
		type: 'init',
		objectId: this.getObjectId(),
		myId: this._myId,
		spaceId: this.isVerified() ? this._spaceId : null,
		sharedData: this.sharedData,
		personalData: this.personalData
	});
};
SpaceObject.prototype.getType = function() {
	return this._type;
};
SpaceObject.prototype.setMyId = function(id) {
	this._myId = id;
};
SpaceObject.prototype.updateUserData = function(user) {
	this.processMessage({
		type: 'update_user',
		userId: user.userId,
		status: user.onlineStatus,
		name: user.getName(),
		style: user.getStyle()
	});
};
SpaceObject.prototype.removeUser = function(userId) {
	this.processMessage({
		type: 'remove_user',
		userId: userId
	});
};
// checks the iframe source
SpaceObject.prototype.checkSource = function(source) {
	return this._iframe.contentWindow === source;
};
SpaceObject.prototype.activate = function() {
	this.processMessage({type: 'activate'});
};
SpaceObject.prototype.deactivate = function() {
	this.processMessage({type: 'deactivate'});
};
SpaceObject.prototype.processMessage = function(message) {
	this._messagePipeline.push(message);
	this._sendMessages();
};

SpaceObject.prototype._sendMessages = function() {
	if (this._loaded && this._iframe.contentWindow) {
		if (this._messageTimeout) {
			clearTimeout(this._messageTimeout);
			this._messageTimeout = false;
		}
		while (this._messagePipeline.length) {
			var message = this._messagePipeline.shift();
			this._iframe.contentWindow.postMessage(message, '*');
		}
	}
	else {
		// try again if not loaded
		this._messageTimeout = setTimeout(this._sendMessages.bind(this), 500);
	}
};

SpaceObject.prototype.getListItemInfo = function() {
	return this._listItemInfo;
};
SpaceObject.prototype.setListItemInfo = function(info) {
	this._listItemInfo = info;
};
SpaceObject.prototype.getSharedData = function() {
	return this.sharedData;
};
SpaceObject.prototype.getPersonalData = function() {
	return this.personalData;
};
SpaceObject.prototype.setPersonalData = function(data) {
	this.personalData = data;
};
SpaceObject.prototype.getObjectType = function() {
	return this._type;
};
SpaceObject.prototype.getObjectId = function() {
	return this._objectId;
};
SpaceObject.prototype.remove = function() {
	this._container.remove();
	delete this._container;
	delete this;
};
;
'use strict';

function Space(key, spaceData) {
	this.key = key.toLowerCase();
	this.spaceId = Global.generateId(this.key);
	this.userKey = spaceData && spaceData.userKey ? spaceData.userKey : null;
	this.spaceName = spaceData && spaceData.spaceName ? spaceData.spaceName : null;
	this.passwordHash = ''; // keccak
	this.passwordCheck = ''; // customHash

	this.privateObjectsData = spaceData.privateObjectsData ? spaceData.privateObjectsData : {};

	this.objects = {};
	this._objectsPositions = {};
	this._temporaryPreferredPositions = {};

	this._createLayout();
	this._createListItem();

	if ("about" == key) {
		this._createAbout();
	} else {
		this._createTopMenu(this.layout);
		this.userList = new UserList(this);
		this._addObject(new Loading(this, this._generateObjectId()));
	}

};

Space.prototype._createLayout = function() {
	this.layout = $('<div class="layout">');
	this.objectsContainer = $('<div class="space-objects">');
	this.layout.append(this.objectsContainer);
	$(function() {
		$('.content').append(this.layout);
	}.bind(this));
};

Space.prototype._addObject = function(object) {

	// Check the object interface
	Global.checkFunctions(object, [ 'createLayout', 'processMessage', 'remove', 'removeUser', 'activate', 'deactivate',
			'getListItemInfo', 'getSharedData', 'getType', 'setMyId', 'getPersonalData', 'getObjectId' ]);

	object.setMyId(this.userList.myId);

	this.objects[object.getObjectId()] = object;

	object.createLayout(this.objectsContainer);

	this.updateListItem();
};

Space.prototype._generateObjectId = function() {
	return Global.randomString(8);
};

Space.prototype._setObjectPosition = function(objectId, position) {
	this._objectsPositions[objectId] = position;

	var container = $('#object_' + objectId);
	if (container.length) {
		container[0].className = container[0].className.replace(/\bposition-[a-z]{1,4}?\b/g, '');
		container.addClass('position-' + position);
	}
};

Space.prototype._getCollidablePositions = function(position) {
	switch (position) {
		case 'n': return ['e', 'w', 'nw', 'ne'];
		case 's': return ['e', 'w', 'sw', 'se'];
		case 'e': return ['s', 'n', 'se', 'ne'];
		case 'w': return ['s', 'n', 'sw', 'nw'];

		case 'ne': return ['n', 'e'];
		case 'se': return ['s', 'e'];
		case 'nw': return ['n', 'w'];
		case 'sw': return ['s', 'w'];

		case 'full':
		default:
			return ['n', 's', 'e', 'w', 'ne', 'se', 'nw', 'sw'];
	}
};
Space.prototype._positionsCollide = function(p1, p2) {
	if (!p1 || !p2 || p1 == 'full' || p2 == 'full' || p1 == p2) {
		return true;
	}
	return -1 != $.inArray(p1, this._getCollidablePositions(p2));
};

Space.prototype._findObjectPosition = function(objectId) {

	var o = $('#object_' + objectId);
	if (!o.length) {
		return null;
	}

	var positions = ['n', 's', 'e', 'w', 'ne', 'se', 'nw', 'sw'];
	for (var i = 0, l = positions.length; i < l; ++i) {
		if (o.hasClass('position-' + positions[i])) {
			return positions[i];
		}
	}
	return 'full';
};

Space.prototype._findCollidableObjects = function(position) {
	var objectIds = [];
	for (var key in this.objects) {
		if (key in this._objectsPositions) {
			if (this._positionsCollide(this._objectsPositions[key], position)) {
				objectIds.push(key);
			}
		}
		else {
			objectIds.push(key);
		}
	}
	return objectIds;
};

Space.prototype._positionToFreeArea = function(objectId) {
	var position = this._findObjectPosition(objectId);
	var checkPositions = new Array();
	if (objectId in this._temporaryPreferredPositions) {
		checkPositions.push(this._temporaryPreferredPositions[objectId]);
	}
	checkPositions.push(position);

	//var count = Object.keys(this.objects).length;
	switch (position) {
		case 'n':
			checkPositions = ['w', 'e', 'nw', 'ne', 's'];
			break;
		case 's':
			checkPositions = ['w', 'e', 'sw', 'se', 'n'];
			break;
		case 'e':
			checkPositions = ['n', 's', 'ne', 'se', 'w'];
			break;
		case 'w':
			checkPositions = ['n', 's', 'nw', 'sw', 'e'];
			break;
	}

	checkPositions.push('nw', 'sw', 'ne', 'se');

	for (var i = 0, l = checkPositions.length; i < l; ++i) {
		var collidable = this._findCollidableObjects(checkPositions[i]);
		if (collidable.length == 0 || collidable.length == 1 && collidable[0] == objectId) {
			// found free area
			this._setObjectPosition(objectId, checkPositions[i]);
			return;
		}
	}
};


// leaveIntact is the object's ID that must not be repositioned
Space.prototype._autoPositionCollidableObjects = function(leaveIntact) {

	var objectCount = Object.keys(this.objects).length;
	var fixedPositions;
	switch (objectCount) {
		case 1:
			fixedPositions = ['w'];
			break;
		case 2:
		case 3:
			fixedPositions = ['w', 'ne', 'se'];
			break;
		case 4:
		default:
			fixedPositions = ['nw', 'sw', 'ne', 'se'];
			break;
	}
	var positionCount = Object.keys(this._objectsPositions).length;
	if (objectCount != positionCount) {
		console.log('not all objects have positions set, hard-fixing');
		var i = 0;
		for (var key in this.objects) {
			this._setObjectPosition(key, fixedPositions[i++]);
		}
		return;
	}

	var positions = new Array();
	if (leaveIntact) {
		var pos = this._findObjectPosition(leaveIntact);
		if (pos) {
			positions.push(pos);
		}
		else {
			leaveIntact = false;
		}
	}

	if (!positions.length) {
		positions = ['nw', 'sw', 'ne', 'se'];
	}
	var positionChanged = new Array();
	for (var i = 0; i < positions.length; ++i) {
		var collidable = this._findCollidableObjects(positions[i]);
		if (collidable.length > 1) {
			for (var j = 0, l = collidable.length; j < l; ++j) {
				if (!leaveIntact || collidable[j] != leaveIntact) {
					this._positionToFreeArea(collidable[j]);
					positionChanged.push(collidable[j]);
				}
			}
		}
	}

	if (leaveIntact) {
		// position items to temporary preferred positions (same as used to be)
		for (var key in this._temporaryPreferredPositions) {
			if (key == leaveIntact)
				continue;
			// only position items that have not been positioned by conflict
			if (-1 == $.inArray(key, positionChanged)) {
				var position = this._temporaryPreferredPositions[key];
				var collidable = this._findCollidableObjects(position);
				if (collidable.length == 0 || collidable.length == 1 && collidable[0] == key) {
					this._setObjectPosition(key, position);
				}
			}
		}
	}
};

Space.prototype._saveSettings = function() {
	var settingsData = {
		objects : []
	};
	for (var key in this.objects) {
		var o = this.objects[key];
		var data = o.getSharedData();
		if (!data) {
			data = {};
		}
		data.objectId = key;
		data.objectType = o.getObjectType();
		var pos = this._findObjectPosition(key);
		if (pos) {
			data.objectPosition = pos;
		}
		settingsData.objects.push(data);
	}
	this.send('save_space_settings', this.encrypt(JSON.stringify(settingsData)));
};

Space.prototype._loadSettings = function(cryptedSettings) {
	try {
		var settings = JSON.parse(this.decrypt(cryptedSettings));
		if (settings) {
			var currentObjects = {};
			for (var key in this.objects) {
				currentObjects[key] = this.objects[key];
			}
			var objects = settings.objects;
			for (var i = 0, l = objects.length; i < l; ++i) {

				var objectData = objects[i];

				// this object is already loaded
				if (objectData.objectId && objectData.objectId in currentObjects) {
					if (objectData.objectPosition) {
						this._setObjectPosition(objectData.objectId, objectData.objectPosition);
					}
					delete currentObjects[objectData.objectId];
					continue;
				}

				// load private account data about object
				var personalData = null;
				if (this.privateObjectsData && objectData.objectId in this.privateObjectsData) {
					personalData = this.privateObjectsData[objectData.objectId];
				}

				// create a new object and add it to space
				if (objectData.objectType) {
					var o = new SpaceObject(objectData.objectType, objectData.objectId, this.spaceId, objectData, personalData);
					this._addObject(o);
				}
				if (objectData.objectPosition) {
					this._setObjectPosition(objectData.objectId, objectData.objectPosition);
				}
			}

			// delete objects that were not in new settings
			for (var key in currentObjects) {
				this._removeObjectByKey(key);
			}
		}
		this._setAddAppButtons(true);
	} catch (e) {
		console.error(e);
	}
};

Space.prototype.getAccountSaveData = function() {
	for (var key in this.objects) {
		var objectData = this.objects[key].getPersonalData();
		if (objectData) {
			this.privateObjectsData[key] = objectData;
		}
	}

	return {
		userKey : this.userKey,
		spaceName : this.spaceName,
		privateObjectsData : this.privateObjectsData
	};
};

Space.prototype._removeObjectsOfType = function(types) {
	for (var i = 0, l = types.length; i < l; ++i) {
		var type = types[i];
		this._findKeysOfType(type).forEach(function(key) {
			this._removeObjectByKey(key);
		}.bind(this));
	}
	this.updateListItem();
};

Space.prototype._removeObjectByKey = function(key) {
	if (key in this.objects) {
		var obj = this.objects[key];
		obj.remove();
		delete this._objectsPositions[key];
		delete this.objects[key];
	}
};

Space.prototype._removeAllObjects = function() {
	for (var key in this.objects) {
		var obj = this.objects[key];
		obj.remove();
		delete this._objectsPositions[key];
		delete this.objects[key];
	}
};

Space.prototype._updateUser = function(user) {
	if (!user)
		return;

	for (var key in this.objects) {
		if (this.objects[key] && typeof this.objects[key].updateUserData == 'function') {
			this.objects[key].updateUserData(user);
		}
	}
};
Space.prototype.setUserOffline = function(userId) {
	if (this.userList) {
		this.userList.setUserOffline(userId);
	}
	for (var key in this.objects) {
		this.objects[key].removeUser(userId);
	}
};

Space.prototype.setSpaceName = function(name) {
	this.spaceName = name;
	var text = this.listItemLink.find('div');
	if (this.spaceName) {
		text.text(this.spaceName);
		text.removeClass('icon-hash icon-right-dir');
	}
	else {
		text.text(this.key ? this.key : 'Frontpage');
		text.addClass(this.key ? 'icon-hash' : 'icon-right-dir');
	}
};

Space.prototype._createListItem = function() {
	if (!this.listItem) {
		var item = $('<li>');
		var itemLink = $('<a class="space-link"><div></div></a>');
		itemLink.attr('href', '#' + this.key);
		itemLink.click(function(e) {
			$('#sidebar').removeClass('show-menu');
			if (account.accountIsSaved) {
				e.preventDefault();
				account.activateSpace(this);
			}
		}.bind(this));
		item.append(itemLink);
		itemLink.append('<span class="indicators">');

		var menuLink = $('<a class="menu-link icon-menu-down">');
		menuLink.attr('href', '#' + this.key);
		item.append(menuLink);

		this.listItemLink = itemLink;
		this.listItem = item;

		this.setSpaceName(this.spaceName); // also sets listItemLink text

		$(function() {
			$('#chat-list').append(this.listItem);
		}.bind(this));
	}
	return this.listItem;
};
Space.prototype._setLockIcon = function(locked) {
	var t = this.lockIcon;
	if (t) {
		var lockLink = t.parent();
		if (locked) {
			t.addClass('icon-lock');
			t.removeClass('icon-lock-open');
			t.attr('title', 'Unlock this space');
		}
		else {
			t.addClass('icon-lock-open');
			t.removeClass('icon-lock');
			t.attr('title', 'Lock this space');
		}
	}
};
Space.prototype._createTopMenu = function(parent) {
	var top = $('<div class="space-top">');

	var spaceMenu = $('<div class="space-menu">');
	spaceMenu.on('click', '.menu-item', function(e) {
		e.stopPropagation();
	});
	top.append(spaceMenu);

	var activeToggler = function(e) {
		e.preventDefault();
		var t = $(this);
		t.parents('.space-menu').find('.menu-item').each(function(i, item) {
			item = $(item);
			if (this.is(item)) {
				item.toggleClass('active');
			}
			else {
				item.removeClass('active');
			}
		}.bind(t.parents('.menu-item')));
	};

	// close active menus on click to somewhere else
	this.layout.click(function(e) {
		this.layout.find('.space-menu .menu-item.active').removeClass('active');
	}.bind(this));

	var access = $('<div class="menu-item space-access">');

	var accessLink = $('<a href="#" title="Set access"><span class="icon-key"></span></a>');
	accessLink.click(activeToggler);
	/*accessLink.click(function(e) {
		e.preventDefault();
		$(this).parents('.menu-item').find('input[name="password"]').focus();
	});*/
	access.append(accessLink);

	var accessPopup = $('<div class="menu-popup">');
	access.append(accessPopup);

	var noneBox = $('<div class="popup-radio">');
	var noneRadio = $('<input type="radio" name="access" value="none" id="access_none_' + this.key + '" />');
	var noneLabel = $('<label for="access_none_' + this.key +'">noone can enter</label>');
	noneBox.append(noneRadio, noneLabel);
	accessPopup.append(noneBox);

	var passBox = $('<div class="popup-radio">');
	var passRadio = $('<input type="radio" name="access" value="password" id="access_pass_' + this.key + '" />');
	passRadio.change(function(e) {
		//console.log($('#access_pass_' + this.key).val());
		this.topArea.find('form input[name="password"]').focus();
	}.bind(this));
	var passLabel = $('<label for="access_pass_' + this.key +'">accept password</label>');
	passBox.append(passRadio, passLabel);
	accessPopup.append(passBox);

	var passwordForm = $('<form><input name="password" type="password" /></form>');
	passwordForm.append('<input type="submit" value="Change nickname" style="display: none;" />');
	passwordForm.submit(function(e) {
		e.preventDefault();
		var form = $(e.target);
		var newPassword = form.find('input[name="password"]').val();
		this.setPassword(newPassword);
		form.parents('.menu-item').removeClass('active');
		this.activate();
	}.bind(this));
	passBox.append(passwordForm);

	spaceMenu.append(access);


	var lock = $('<div class="menu-item space-lock">');
	if (!account.accountIsSaved) {
		lock.css('display', 'none');
	}
	var lockLink = $('<a href="#" title="Lock this space"></a>');
	var lockIcon = $('<span class="icon-lock-open">');
	lockLink.append(lockIcon);
	this.lockIcon = lockIcon;
	lockLink.click(function(e) {
		e.preventDefault();
		var wasLocked = this.lockIcon.hasClass('icon-lock');
		this._setLockIcon(!wasLocked);

		var a = this.topArea.find('.space-access');
		a.setLoading('small').addClass('show');

		if (wasLocked) {
			this.send('space_unlock');
		}
		else {
			this.send('space_lock');
		}
	}.bind(this));
	lock.append(lockLink);
	spaceMenu.append(lock);


	var apps = $('<div class="menu-item space-apps">');
	var appsLink = $('<a href="#" title="Manage apps"></a>');
	var appsIcon = $('<span class="icon-puzzle">');
	appsLink.append(appsIcon);
	appsLink.click(function(e) {
		e.preventDefault();
		this._setObjectModifyState(!this.layout.hasClass('modify-state'));
	}.bind(this));
	apps.append(appsLink);
	spaceMenu.append(apps);

	var about = $('<div class="menu-item">');
	var aboutLink = $('<a href="#" title="About Chatlink"><span class="icon-help-circled"></span></a>');
	aboutLink.click(function(e) {
		e.preventDefault();
		document.location.hash = 'about';
	});
	about.append(aboutLink);
	spaceMenu.append(about);

	this.topArea = top;
	parent.append(top);
};

Space.prototype._resetObjectModifyState = function() {
	this._draggedElement = null;
	this._lastDropTarget = null;
	this._dragStartPosition = null;
	this._temporaryPreferredPositions = {};
};
Space.prototype._setObjectModifyState = function(enable) {
	this._resetObjectModifyState();
	$(document).off('click');
	$(document).off('mouseup');
	this.objectsContainer.find('.drop-area').remove();
	this.objectsContainer.off('mousedown', '.modify-cover');
	this.objectsContainer.off('mousemove', '.drop-area > div');
	this.objectsContainer.find('.modify-cover').remove();
	this.layout.removeClass('modify-state');

	if (enable) {
		this.layout.addClass('modify-state');
		$(document).on('click', function(e) {
			this._setObjectModifyState(false);
		}.bind(this));

		this.objectsContainer.on('mousemove', '.drop-area > div', function(e) {
			if (this._draggedElement) {
				e.preventDefault();

				if (!this._dragStartPosition) {
					this._dragStartPosition = {x: e.pageX, y: e.pageY};
					for (var key in this._objectsPositions) { // just cloning the object
						this._temporaryPreferredPositions[key] = this._objectsPositions[key];
					}
					return;
				}
				// if user has dragged more than 30px, activate the functions
				if (30 < Math.sqrt(Math.pow(this._dragStartPosition.x - e.pageX, 2) + Math.pow(this._dragStartPosition.y - e.pageY, 2))) {
					this._dragStartPosition = {x: -1000, y: -1000};
				}
				else {
					return;
				}

				if (this._lastDropTarget == e.currentTarget) {
					return;
				}
				this._lastDropTarget = e.currentTarget;

				var position = e.currentTarget.className.replace('drop-area-', '');
				this._setObjectPosition(this._draggedElement, position);
				this._autoPositionCollidableObjects(this._draggedElement);
			}
		}.bind(this));

		this.objectsContainer.on('mousedown', '.modify-cover', function(e) {
			e.preventDefault();
			//this._dragStartPosition = null;
			this._setAddAppButtons(false);
			this.objectsContainer.find('.drop-area').remove();

			if (e.button != 0) {
				this._setObjectModifyState(false);
				return;
			}

			if (e.target && e.target.nodeName && e.target.nodeName.toLowerCase() == 'a') {
				// allow clicks on links
				return;
			}

			var parent = $(e.currentTarget).parent('.object-container');
			if (!parent.length) {
				return;
			}

			parent = parent.data('object-id');
			if (!parent) {
				return;
			}

			this._draggedElement = parent;

			var dropArea = $('<div class="drop-area">');
			var appCount = Object.keys(this.objects).length;

			if (appCount == 1) {
				dropArea.append('<div class="drop-area-full">');
			}
			if (appCount <= 3) {
				dropArea.append(
						'<div class="drop-area-nw">',
						'<div class="drop-area-ne">',
						'<div class="drop-area-sw">',
						'<div class="drop-area-se">'
				);
			}

			dropArea.append(
					'<div class="drop-area-n">',
					'<div class="drop-area-s">',
					'<div class="drop-area-e">',
					'<div class="drop-area-w">'
			);

			this.objectsContainer.append(dropArea);
		}.bind(this));

		$(document).on('mouseup', function(e) {
			if (this._draggedElement) {
				e.preventDefault();
				this._resetObjectModifyState();
				this.objectsContainer.find('.drop-area').remove();

				var t = $(e.target);
				if (t.hasClass('add-app') || t.parents('.add-app').length) {
					return;
				}
				this._setAddAppButtons(true);
			}
		}.bind(this));


		this.objectsContainer.find('.object-container').each(function(i, item) {
			item = $(item);
			if (item.hasClass('add-app')) {
				return true;
			}
			var modifyCover = $('<div class="modify-cover">');
			modifyCover.click(function(e) {
				e.preventDefault();
				e.stopPropagation();
			});

			var objectId = item.data('object-id');
			if (objectId in this.objects) {
				var object = this.objects[objectId];
				var title = $('<div class="object-title">');
				title.text(object.getType());
				modifyCover.append(title);
			}

			var removeButton = $('<a href="#" class="remove-object icon-cancel">');
			removeButton.click(function(e) {
				e.preventDefault();
				e.stopPropagation();
				this._removeObjectByKey(objectId);
				this.send('delete_object', '', objectId);
				this._setAddAppButtons(true);
			}.bind(this));
			modifyCover.append(removeButton);

			item.append(modifyCover);
		}.bind(this));
	}
	else {
		this._saveSettings();
	}
};

Space.prototype._setAddAppButtons = function(show) {
	this.objectsContainer.find('.add-app').remove();
	if (show) {
		var positionChecks = ['full', 'e', 'w', 'n', 's', 'se', 'ne', 'nw', 'sw'];
		for (var i = 0, l = positionChecks.length; i < l; ++i) {
			var pos = positionChecks[i];
			var collisions = this._findCollidableObjects(pos);
			if (!collisions.length) {
				var plusArea = $('<div class="add-app object-container">');
				plusArea.addClass('position-' + pos).css('border', 'none');
				plusArea.click(function(e) {
					if (this.layout.hasClass('modify-state')) {
						this._setObjectModifyState(false);
					}
				}.bind(this));

				plusArea.on('click', 'a', function(e) {
					e.preventDefault();
					e.stopPropagation();
					var target = $(e.target);
					var type = target.data('app-type');
					if (type) {
						var newId = this._generateObjectId();
						this._addObject(new SpaceObject(type, newId, this.spaceId));
						this._setObjectPosition(newId, pos);
						if (this.layout.hasClass('modify-state')) {
							this._setObjectModifyState(true); // reload state
						}
						else {
							this._saveSettings();
						}
						this._setAddAppButtons(true);
					}
					else {
						console.log('Could not find type of app!', e.target);
					}

				}.bind(this));

				var buttons = $('<div class="add-app-buttons">');
				plusArea.append(buttons);

				var types = ['chat', 'list', /*'video-broadcast', 'topic-top' */];
				for (var j = 0, l2 = types.length; j < l2; ++j) {
					var t = types[j];
					var newAppButton = $('<a class="icon-plus"></a>');
					newAppButton.text(t);
					newAppButton.data('app-type', t);
					buttons.append(newAppButton);
				}

				this.objectsContainer.append(plusArea);
				return;
			}
		}
	}
};

Space.prototype.hasObject = function(key) {
	return key in this.objects;
};
Space.prototype._hasAnyObjects = function() {
	return !$.isEmptyObject(this.objects);
};
Space.prototype._findObjectsOfType = function(type) {
	var objects = [];
	for (var key in this.objects) {
		if (type == this.objects[key].getType())  {
			objects.push(this.objects[key]);
		}
	}
	return objects;
};
Space.prototype._findKeysOfType = function(type) {
	var keys = [];
	for (var key in this.objects) {
		if (type == this.objects[key].getType()) {
			keys.push(key);
		}
	}
	return keys;
};

// looks for message.objectId
Space.prototype._findObjectByMessage = function(message) {
	if (message.objectId) {
		if (message.objectId in this.objects) {
			return this.objects[message.objectId];
		} else {
			console.info('could not find an object with id ' + message.objectId);
		}
	} else {
		console.info('message.objectId not set!', message);
	}
	return null;
};

Space.prototype.isActive = function() {
	return this.listItem.hasClass('active');
};

Space.prototype.activate = function() {
	this.listItem.addClass('active');
	this.layout.addClass('active');

	for (var key in this.objects) {
		var object = this.objects[key];
		object.activate();
	}
};
Space.prototype.deactivate = function() {
	for (var key in this.objects) {
		var object = this.objects[key];
		object.deactivate();
	}
};
Space.prototype.escapePressed = function() {
	this.layout.find('.space-menu .menu-item.active').removeClass('active');
	if (this.layout.hasClass('modify-state')) {
		this._setObjectModifyState(false);
	}
};

Space.prototype._getListItemWithClass = function(clazz) {
	var item = this.listItemLink.find('.indicators .' + clazz);
	if (!item.length) {
		item = $('<span class="' + clazz + '"></span>');
		this.listItemLink.find('.indicators').append(item);
	}
	return item;
};

Space.prototype._removeListItemWithClass = function(clazz) {
	this.listItemLink.find('.indicators .' + clazz).remove();
};

Space.prototype.getUnreadCount = function() {

	var unread = 0;
	for (var key in this.objects) {
		var info = this.objects[key].getListItemInfo();
		if (info) {
			if (info.unreadCount) {
				unread += info.unreadCount;
			}
		}
	}
	return unread;
};

Space.prototype.updateListItem = function() {

	var unread = 0;
	var loading = false;
	var locked = false;

	for (var key in this.objects) {
		var info = this.objects[key].getListItemInfo();
		if (info) {
			if (info.isLoading) {
				loading = true;
			}
			if (info.isLocked) {
				locked = true;
			}
			if (info.unreadCount) {
				unread += info.unreadCount;
			}
		}
	}

	if (loading) {
		this.layout.addClass('loading');
		//this.listItem.setLoading('small');
		this._getListItemWithClass('loading').setLoading('small-no-bg');
	} else {
		this.layout.removeClass('loading');
		//this.listItem.clearLoading();
		this._removeListItemWithClass('loading');
	}

	if (locked) {
		this.layout.addClass('locked');
		this._getListItemWithClass('locked').addClass('icon-lock');
	} else {
		this.layout.removeClass('locked');
		this._removeListItemWithClass('locked');
	}

	if (unread) {
		this._getListItemWithClass('new').text(unread);
	} else {
		this._removeListItemWithClass('new');
	}

	account.updateTitle();
};

// TODO: maybe use Account.sendLoadRequest(data) instead, maybe
// subscribe and load messages
Space.prototype.initUrl = function() {

	if (!connection.isConnected()) {
		return;
	}

	var last = 0;
	if (this.privateObjectsData) {
		for (var key in this.privateObjectsData) {
			if (this.privateObjectsData[key] && this.privateObjectsData[key].lastMessageTime) {
				var d = new Date(this.privateObjectsData[key].lastMessageTime);
				if (d > last)
					last = d;
			}
		}
	}

	var dataObj = {
		urlId : this.spaceId,
		userKey : this.userKey,
		checkPassword : this.passwordCheck
	};
	if (last) {
		dataObj.lastMessageTime = last.toISOString();
	}
	connection.send({
		type : 'init_url',
		data : JSON.stringify(dataObj)
	});
};

Space.prototype.fullyInitUrl = function() {
	if (!connection.isConnected()) {
		return;
	}
	if (this._inited)
		return;

	var dataObj = {
		urlId : this.spaceId,
		userKey : this.userKey,
		checkPassword : this.passwordCheck
	};
	connection.send({
		type : 'init_url',
		data : JSON.stringify(dataObj)
	});
};

// Local object sent a message
Space.prototype.processMessageFromObject = function(objectId, event) {
	var object = this.objects[objectId];

	if (!object.checkSource(event.source)) {
		alert('wrong source of message! (not the iframe it should be)');
		return;
	}

	var message = event.data;
	var type = message.type;


	switch (type) {
		case 'update_list_item':
			object.setListItemInfo(message.info);
			this.updateListItem();
			break;
		case 'load_user':
			var u = this.userList.findUser(message.userId);
			if (u) {
				object.updateUserData(u);
			}
			break;

		case 'update_personal_data':
			object.setPersonalData(message.data);
			break;

		case 'navigate_parent':
			if (!object.isVerified()) {
				console.error('Unverified objects cannot navigate parent', object);
				return;
			}
			if (!this.isActive()) {
				console.error('Inactive space cannot navigate parent', object);
				return;
			}
			if (message.address) {
				if(message.address.charAt(0) == '/') {
					document.location.href = message.address;
				}
				else {
					window.open(message.address, '_blank');
				}
			}
			break;
		case 'delete_message':
			this.send(type, message.messageId, objectId);
			break;
		case 'delete_all_messages':
			this.send('delete_object_messages', '', objectId);
			break;

		case 'general_saved':
			type = 'general';
		case 'general_unsaved':
		case 'general_unsaved_others':
			if (typeof message.original === 'undefined') {
				console.error('General message must carry original data', message);
				return;
			}
			this.send(type, this.encrypt(JSON.stringify(message.original)), objectId);
			break;

		default:
			console.error('Unimplemented message type: ', type);
			break;
	}
};

Space.prototype.processMessage = function(message) {
	switch (message.type) {
		case 'no_changes':
			console.log('no changes in ' + this.key);
			this._removeAllObjects();
			this.updateListItem();
			break;
		case 'account_public':
			this._inited = true;
			this._removeAllObjects();
			if (!account.accountIsSaved) {
				$('#account-id-show').text(this.key);
				account.settings.show('', true);
				$('#account-id-input').trigger('change');
			}

			if (message.publicKey) {
				this._addObject(new RequestForm(this, message.publicKey, this._generateObjectId()));
			}
			else {
				console.error('Unfortunately user has no public key');
			}
			account.activateSpaceIfActive(this);
			break;

		case 'save_space_settings':
			console.info('Someone saved space settings of #' + this.key + ', loading settings');
			this._loadSettings(message.data);
			this._autoPositionCollidableObjects();
			if (this.layout.hasClass('modify-state')) {
				this._setObjectModifyState(true); // reload modify state
			}
			for (var i = 0, l = this.userList.users.length; i < l; ++i) {
				this._updateUser(this.userList.users[i]);
			}
			account.activateSpaceIfActive(this);
			break;

		case 'delete_object':
			var obj = this._findObjectByMessage(message);
			if (obj) {
				this._removeObjectByKey(message.objectId);
			}
			break;

		case 'contact_request_ack':
		case 'delete_object_messages':
		case 'delete_message':
			var obj = this._findObjectByMessage(message);
			if (obj) {
				obj.processMessage(message);
			}
			else {
				console.log('Object not found for ' + message.type, message);
			}
			break;

		case 'load_space':
			this._inited = true;
			if ("about" == this.key) {
				break;
			}
			//console.time('load_space');
			var obj = JSON.parse(message.data);
			//console.info('loading space #' + this.key);//, obj);
			if (obj) {
				//console.log('load space', obj);
				//console.log('space settings', this.decrypt(obj.settings));

				this._removeObjectsOfType(['loading']);

				if (obj.locked) {
					this._setLockIcon(true);
				}
				else {
					this._setLockIcon(false);
				}

				if (obj.yourId) {
					this.userList.myId = obj.yourId;
				}

				if (obj.userKey) {
					this.userKey = obj.userKey;
				} else {
					console.error('NO USER KEY GIVEN FOR #' + this.key + '!');
				}

				if (obj.settings) {
					this._loadSettings(obj.settings);
				}
				// if space has no objects, lets add some
				if (!this._hasAnyObjects()) {
					console.log('no objects, adding a default chat for #' + this.key);
					var chatId = this._generateObjectId();
					this._addObject(new SpaceObject('chat', chatId, this.spaceId));
					if (Global.isSmallScreen()) {
						this._setObjectPosition(chatId, 'position-full');
					} else {
						this._setObjectPosition(chatId, 'w');
					}
					this._saveSettings();
					this._setAddAppButtons(true);
				}
				//this._autoPositionCollidableObjects();

				//console.time('load_space_users');
				if (obj.users) {
					//console.log('user count: ' + obj.users.length);
					for (var i = 0, l = obj.users.length; i < l; ++i) {
						var user = obj.users[i];
						if (i > 9 && 'online' != user.onlineStatus) {
							this.userList.addUnrenderedUser(user);
							continue;
						}
						user.name = this.decrypt(user.name);
						user = this.userList.addUser(user);
						this._updateUser(user);
					}
					this.userList.sortUsers();
				}
				//console.timeEnd('load_space_users');

				//console.time('load_space_messages');
				if (obj.messages) {
					//var types = {};
					for (var i = 0, l = obj.messages.length; i < l; ++i) {
						var m = obj.messages[i];
						/*if (!types[m.type])
							types[m.type] = 1;
						else
							types[m.type]++;
							*/
						this.processMessage(m);
					}
					//console.log('message count:' + obj.messages.length, types);
				}
				//console.timeEnd('load_space_messages');
				$(function() {
					account.activateSpaceIfActive(this);
					// scroll chats to bottom
					// TODO: should scroll to last message
					/*this._findObjectsOfType(Chat).forEach(function(chat) {
						chat.scrollToBottom(true);
					}.bind(this));
					*/
				}.bind(this));
			}
			//console.timeEnd('load_space');
			break;

		case 'login':
			var userData = JSON.parse(message.data);
			if (userData) {
				if (userData.name) {
					userData.name = this.decrypt(userData.name);
				}

				// If user is already online, no need to say "logged in".
				// This happens when connection goes down and up again.
				var user = this.userList.findUser(userData.userId);
				var addMessage = true;
				if (user && 'online' == user.onlineStatus) {
					addMessage = false;
				}
				user = this.userList.addUser(userData);

				this._updateUser(user);
				this.userList.sortUsers();

				if (addMessage) {
					/*
					this._findObjectsOfType(Chat).forEach(function(chat) {
						chat.processMessage(message);
					}.bind(this));
					*/
				}
			}
			break;

		case 'logout':
			this.setUserOffline(message.userId);
			break;

		case 'space_locked': // space is locked for you, no access
			this._removeAllObjects();
			this._addObject(new Locked(this, this._generateObjectId()));
			break;

		case 'space_lock':
			this.topArea.find('.space-access').clearLoading().addClass('show');
			this._setLockIcon(true);
			break;

		case 'space_unlock':
			this.topArea.find('.space-access').clearLoading().removeClass('show');
			this._setLockIcon(false);
			if (!this.userKey) {
				// space was never loaded
				this.initUrl();
			}
			break;

		case 'change_nick':
			var newNick = this.decrypt(message.data);
			var user = this.userList.changeNick(message.userId, newNick);
			if (user) {
				this._updateUser(user);
				this.userList.sortUsers();
			}
			break;

		case 'change_picture':
			var newPic = this.decrypt(message.data);
			var user = this.userList.changePicture(message.userId, newPic);
			if (user) {
				this._updateUser(user);
				this.userList.sortUsers();
			}
			break;

		case 'set_space_password':


			console.info(message);

			// TODO: Delete all old messages in this space, because they are encrypted wiht different key

			// TODO: overlay
			var plainPass = null;
			// a loop here???
			while (this.passwordCheck != message.data) {
				plainPass = prompt('Insert password to access this chat.');
				this.passwordCheck = Global.customHash(plainPass);
			};
			if (plainPass)
				this.passwordHash = Global.keccakHash(plainPass);
			break;

		case 'general':
			if (!this._inited) {
				this.fullyInitUrl();
				return;
			}
			var o = this._findObjectByMessage(message);
			if (o) {
				message.original = JSON.parse(this.decrypt(message.data));
				delete message.spaceId;
				delete message.data;
				o.processMessage(message);
			} else {
				console.info('no object found for general message: ', message);
			}
			break;
		default:
			console.error('Unimplemented message type: ' + message.type, message);

	}
};

Space.prototype.findUser = function() {
	if (!this.userList.myId)
		return null;

	return this.userList.findUser(this.userList.myId);
};

Space.prototype.changeNick = function(newNick) {
	if (newNick && this.userList && this.userList.myId) {
		this.send('change_nick', this.encrypt(newNick));
	}
};
Space.prototype.setPassword = function(password) {
	this.passwordHash = Global.keccakHash(password, this.key);
	this.passwordCheck = Global.customHash(password, this.key);
	this.send('set_space_password', this.passwordCheck);
};
Space.prototype.send = function(type, data, objectId) {
	var obj = {
		spaceId : this.spaceId,
		userKey : this.userKey,
		type : type,
		data : data
	};
	if (objectId) {
		obj.objectId = objectId;
	}
	connection.send(obj);
};

Space.prototype.encrypt = function(input) {
	return Global.encrypt(input, this.key + this.passwordHash);
};
Space.prototype.decrypt = function(input) {
	return Global.decrypt(input, this.key + this.passwordHash);
};

Space.prototype._unsubscribe = function() {
	this.send('unsubscribe_space');
};

Space.prototype.remove = function(noUnscribe) {
	if (!noUnscribe) {
		this._unsubscribe();
	}
	this.listItem.remove();
	this.layout.remove();
};

Space.prototype._createAbout = function() {
	this.layout.find('.space-objects').empty();
	$.get('/~about.html', function(data) {
		var aboutContent = $('<div class="object-container position-full about">');
		aboutContent[0].innerHTML = data.replace(/<script/i, '<noscript');
		this.layout.find('.space-objects').append(aboutContent);
		aboutContent.touchScroll();
	}.bind(this), 'html');
};
;
'use strict';

var account = new Account(Global.getUrlKey());

var connection = new Connection();
connection.connect();

var hashChange = function(start) {
	var key = Global.getUrlKey();

	if (key) {
		if (key.substring(0, 11) == "~scroll-to-") {
			window.location.hash = "#about";
			return;
		}
		account.addSpace(key);
		account.activateSpace(key);
	}
};
var saveCheck = function() {
	if (account.confirmExit()) {
		account.save();
		return 'Your account is not saved.';
	}
};

var objectMessage = function(e) {
	var event = e.originalEvent;
	if (event.origin === 'null' || event.origin === origin) {
		account.processMessageFromObject(event);
	}
	else {
		alert('wrong origin! was ' + event.origin + ', but expected ' + origin);
	}
};

$(window).on('hashchange', hashChange)
	.on('beforeunload', saveCheck)
	.on('message', objectMessage);

$(function() {
	hashChange(true);
	account.init();

	// mobile-only stuff
	$('.mobile-menu-link').click(function(e) {
		e.preventDefault();
		$('#sidebar').toggleClass('show-menu');
		$(document).on('click', '.layout', function(e) {
			$('#sidebar.show-menu').removeClass('show-menu');
			$(document).off('click');
		});
	});
	$('#sidebar').touchScroll();

	// Frontpage methods

	if (Global.isSmallScreen() && !Global.getUrlKey()) {
		$('.frontpage').removeClass('frontpage');
		$('#sidebar').addClass('show-menu');
		var elem = document.body;
		if (elem.requestFullscreen) {
			lem.requestFullscreen();
		} else if (elem.msRequestFullscreen) {
			elem.msRequestFullscreen();
		} else if (elem.mozRequestFullScreen) {
			elem.mozRequestFullScreen();
		} else if (elem.webkitRequestFullscreen) {
			elem.webkitRequestFullscreen();
		}
	}

	$('#add-new-space-form').submit(function(e) {
		e.preventDefault();
		var key = $('#myurl').val();
		if (key) {
			window.location.hash = '#' + key;
			$('#myurl').val('');
		}
		else {
			setTimeout(function() {
				window.location.hash = '#' + Global.randomString();
			}, 50);
		}
	});
	$('#myurl').focus();

	$('body').on('touchmove', function(e){
		e.preventDefault();
	});

});
;
