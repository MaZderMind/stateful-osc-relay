var
	// load in some config
	config = require('./config.js'),

	// gotta to talk to our os through this
	os = require('os'),

	// we want to do our own datagram action
	dgram = require('dgram'),

	// create an unbound socket to emit messages
	esock = dgram.createSocket('udp4'),

	// and osc parsing is good to have, too
	osc = require('osc-min'),

	// the zeroconf/multicast module
	mdns = require('mdns2'),

	// http-module for a web-gui
	http = require('http'),

	// fs-module for filesystem juggeling
	fs = require('fs'),

	// patg-module for path manipulatiom
	path = require('path'),

	// less-module for dynamic recompile of less-css files
	less = require('less'),

	// static file server to .. serve static files
	staticfiles = require('node-static'),

	// socket.io for realtime-communication over http
	socketio = require('socket.io'),

	// re-use the socket.io logger
	Logger = require('socket.io/lib/logger'),
	logger = new Logger();

	// communication port for web-clients
	io = null,

	// collect a list of available ip adresses for each local interface
	addresses = [],

	// list of currently known presets
	presets = [],

	// currently connected guests by name
	guests = {},

	// having a little state is also a good idea
	state = {};


logger.log('info', 'Starting up the System');

// start monitoring local ip adresses
updateLocalAdresses();

// show a welcome message with useful information
showWelcomeMessage();

// advertise our osc-service
advertiseService();

// start an mdns-browser, watching for osc compatible guests
startGuestBrowser();

// start the lesscss recompile
startLessCssRecompiler();

// start the relay operation
loadPresets();

// start the web inspection & management ui
startWebUi();

// start the relay operation
startRelay();



/// implementation


// collect a list of available ip adresses for each local interface
function updateLocalAdresses()
{
	var interfaces = os.networkInterfaces();

	addresses = [];

	// iterate all interfaces by name
	for(var ifName in interfaces)
	{
		// iterate all adresses of these interface
		interfaces[ifName].forEach(function(ifAddressInfo)
		{
			// collect external ipv4 adresses
			if(ifAddressInfo.family == 'IPv4' && !ifAddressInfo.internal)
				addresses.push({ifName: ifName, address: ifAddressInfo.address});
		});
	};

	logger.log('info', 'enumerated', addresses.length, 'non-internal local ip adresses on', Object.keys(interfaces).length, 'network interfaces');
}



// show a welcome message with useful information
function showWelcomeMessage()
{
	// print that list and the configured port for the users convinience
	logger.log('info', 'printing a nice message for the users convinience');
	console.log("");
	console.log("Configure your OSC-Clients like this:")
	if(addresses.length == 0)
	{
		console.log("Host:         [can't find your ip - sorry]");
	}
	else if(addresses.length == 1)
	{
		console.log("Host:         ", addresses[0].address);
	}
	else
	{
		console.log("  Host:");
		addresses.forEach(function(address) {
			console.log("    "+address.ifName+': '+address.address);
		});
	}

	console.log("Outgoing Port:", config.receivePort);
	console.log("");

	// print some info about the webui
	console.log("To see the WebUi, go to http://127.0.0.1:" + config.webUiPort);
	console.log("");
}



// advertise our osc-service
function advertiseService()
{
	logger.log('info', "Advertising our relay via Zeroconf");

	// advertise our relay service
	mdns.createAdvertisement(
		mdns.udp('osc'),
		config.receivePort,
		{
			name: 'Stateful OSC-Relay on '+os.hostname()
		}
	).start();

	// advertise our WebUI
	mdns.createAdvertisement(
		mdns.tcp('http'),
		config.webUiPort,
		{
			name: 'WebUI of Stateful OSC-Relay on '+os.hostname()
		}
	).start();
}



// start an mdns-browser, watching for osc compatible guests
function startGuestBrowser()
{
	var mdnsBrowser = mdns.createBrowser(mdns.udp('osc'));

	// wait for ZeroConf events
	logger.log('info', 'looking for new guests using ZeroConf');

	// on servide up
	mdnsBrowser.on('serviceUp', function(service)
	{
		// sometimes an andvertisement without an address comes through..
		if(service.addresses && service.addresses.length == 0)
			return;

		// test all our own external adresses to filter out our own advertisement
		for(var idx in addresses)
		{
			var address = addresses[idx];
			if(service.addresses.indexOf(address.address) !== -1 && service.port === config.receivePort)
				return;
		}

		// update the list of internal addresses so we don't eat our own announcement when changing ips
		updateLocalAdresses();

		// test our internal address
		if(service.addresses.indexOf('127.0.0.1') !== -1 && service.port === config.receivePort)
			return;

		// test all static configured guests and ignore their advertisements
		for(var name in config.staticGuests)
		{
			var guest = config.staticGuests[name];
			if(service.addresses.indexOf(guest.address) !== -1 && service.port === guest.port)
				return;
		}

		// ignore known guests
		if(guests[service.name])
		{
			// update guest timeout
			var guest = guests[service.name];

			if(config.guestTimeout > 0)
			{
				clearTimeout(guest.timeout);
				guest.timeout = setTimeout(function() {
					// save state for a short time and delete from guest hash
					delete guests[service.name];

					// print a message
					logger.log('info', 'guest "'+service.name+'"  timeouted after ', config.guestTimeout, 'seconds:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');

					// notify the web-ui clients
					updateWebUi('timeout');
				}, config.guestTimeout * 1000);
			}

			// do nothing more
			return;
		}

		// build a new guest record
		var guest = {
			address: service.addresses[0],
			port: service.port
		}

		if(config.guestTimeout > 0)
		{
			// timeout function
			guest.timeout = setTimeout(function() {
				// save state for a short time and delete from guest hash
				var guest = guests[service.name];
				delete guests[service.name];

				// print a message
				logger.log('info', 'guest "'+service.name+'"  timeouted after ', config.guestTimeout, 'seconds:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');

				// notify the web-ui clients
				updateWebUi('timeout');
			}, config.guestTimeout * 1000)
		}

		// save the guest-record in the guests-hash
		guests[service.name] = guest;

		// print another message
		logger.log('info', 'guest "'+service.name+'" up:', service.addresses[0], service.port, '(now '+Object.keys(guests).length+' guests)');

		// notify the web-ui clients
		updateWebUi('guest-up');

		// brief the new guest with our internal state
		logger.log('info', '  briefing new guest with '+Object.keys(state).length+' values')
		var buffer = generateBundleBuffer();
		esock.send(buffer, 0, buffer.length, guest.port, guest.address);
	});
	
	// on service down
	mdnsBrowser.on('serviceDown', function(service)
	{
		// unknwon service
		if(!guests[service.name])
			return;

		// save state for a short time and delete from guest hash
		var guest = guests[service.name];
		delete guests[service.name];

		// clear the timeout
		clearTimeout(guest.timeout);

		// print a message
		logger.log('info', 'guest "'+service.name+'" down:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');

		// notify the web-ui clients
		updateWebUi('guest-down');
	});

	// start the browser
	mdnsBrowser.start();
}



// start the web inspection & management ui
function startWebUi()
{
	// create a static fileserver
	var filesrv = new staticfiles.Server('./public');

	// launch a conventional http server
	var srv = http.createServer(function(request, response)
	{
		request.on('end', function() {
			// potenionally interrupt for own api calls here

			// no matching api-call? serve as file
			filesrv.serve(request, response);
		}).resume()
	});

	// launch a socket.io-communication channel ontop of the webserver
	io = socketio.listen(srv);

	io.configure(function()
	{
		io.enable('browser client minification');  // send minified client
		io.enable('browser client gzip');          // gzip the file
		io.set('log level', 2);                    // reduce logging
		//srv.set("transports", ["xhr-polling"]);
		//srv.set("polling duration", 10);
		//srv.set("heartbeat interval", 15);
		//srv.set("heartbeat timeout", 20);
	});

	io.sockets.on('connection', function(socket)
	{
		// brief fresh connected web-ui clients
		socket.emit('update', 'initial', buildWebUiUpdateBundle())

		// event handlers
		socket.on('newPreset', function(name)
		{
			logger.log('info', 'writing new preset with name', name, 'and', Object.keys(state).length, 'values');

			var elements =  {};
			for(var address in state)
			{
				elements[address] = state[address].args;
			};

			var jsonStr = JSON.stringify(elements);
			fs.writeFile(path.join('presets', name+'.json'), jsonStr, {encoding: 'utf8'}, function(err) {
				if(err)
					return logger.log('error', 'error writing file', err);

				if(presets.indexOf(name) === -1)
					presets.push(name);

				updateWebUi('new preset');
			})
		});
	});


	// update all infos at least every 10 seconds
	setInterval(function() {
		updateWebUi('interval');
	}, 10*1000)

	// start the webserver on the configured port
	srv.listen(config.webUiPort);
}

function startLessCssRecompiler()
{
	// recompile on any change in the less dir
	fs.watch('public/less/', function() {
		// only recompile the app.less - all other files are includes
		recompile('public/less/app.less', 'public/app.css')
	});

	// recompile on startup
	recompile('public/less/app.less', 'public/app.css')



	function recompile(lessfile, cssfile)
	{
		logger.log('debug', 'lesscss recompile '+lessfile+' -> '+cssfile);

		fs.readFile(lessfile, {encoding: 'utf8'}, function(err, lesscode)
		{
			if(err)
				return logger.log('error', 'lesscss error: unable to read less file ' + lessfile, err)

			less.render(
				lesscode,
				{
					//compress: true,
					relativeUrls: true,
					paths: [path.dirname(lessfile)]
				},
				function(err, csscode) {
					if(err)
						return logger.log('error', 'lesscss error', less.formatError(err))

					fs.writeFile(cssfile, csscode, {encoding: 'utf8'}, function(err) {
						if(err)
							return logger.log('error', 'unable to write css file ' + cssfile, err);
					});
				}
			);
		});

	}
}


function updateWebUi(reason)
{
	// no webui - no notifications ;)
	if(!io) return;

	// broadcast ao all clients
	io.sockets.emit('update', reason, buildWebUiUpdateBundle());
}

function buildWebUiUpdateBundle() {
	var webGuests = [];

	for(var name in guests)
	{
		var guest = guests[name];
		webGuests.push({
			a: guest.address,
			p: guest.port,
			s: 'z',
			n: name
		})
	}

	for(var name in config.staticGuests)
	{
		var guest = config.staticGuests[name];
		webGuests.push({
			a: guest.address,
			p: guest.port,
			s: 's',
			n: name
		})
	}

	return {
		t: (new Date()).getTime(),
		g: webGuests,
		p: presets
	}
}


function loadPresets()
{
	logger.log('info', 'loading presets');
	fs.readdir('presets/', function(err, files) {
		files.forEach(function(file) {
			path.parse
			if(path.extname(file) == '.json')
			{
				presets.push(
					path.basename(file, '.json')
				);
			}
		})

		logger.log('info', 'loaded', presets.length,'presets: ', presets);
	});
}


// start the relay operation
function startRelay()
{
	// let's create a udp/ipv4 socket for receiving messages
	var rsock = dgram.createSocket('udp4');

	// bind the receiving socket to the configured
	rsock.bind(config.receivePort);

	// listen for udp messages
	rsock.on('message', function(buffer, rinfo)
	{
		// try to parse the received bytes to a osc-message
		try {
			var message = osc.fromBuffer(buffer);
		} catch (e) {
			return logger.log('warn', 'message parse error', e);
		}

		// catch bogus messages
		if(!message.address)
			logger.log('warn', 'received bogus message from '+rinfo.address+' (no address)');

		// print some message
		logger.log('debug', 'received message from '+rinfo.address+':', message.address, 'with', (message.args ? message.args.length : 0), 'arg(s)');

		// test if the message matches one of the filters
		var filterResult = isMessageFiltered(message.address);
		if(filterResult !== false)
			return logger.log('debug', '   filtered -> ', filterResult);

		// clear previous timeouts
		if(state[message.address])
			clearTimeout(state[message.address].timeout);

		// save the message and its arguments in our internal state array
		state[message.address] = {
			args: message.args
		}

		if(config.valueStoreTimeout > 0)
		{
			state.timeout = setTimeout(function()
			{
				logger.log('info', 'removing message', message.address, 'from internal state');
				delete state[message.address];
			}, config.valueStoreTimeout * 1000)
		}

		// forward message to one of the guests
		function forward(name, guest)
		{
			// if this is the sending guest
			if(guest.address == rinfo.address)
			{
				// update the timeout
				if(config.guestTimeout > 0)
				{
					clearTimeout(guest.timeout);
					guest.timeout = setTimeout(function() {
						// save state for a short time and delete from guest hash
						delete guests[name];

						// print a message
						logger.log('info', 'guest "'+name+'"  timeouted after ', config.guestTimeout, 'seconds:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');
					}, config.guestTimeout * 1000);
				}
			}

			// print a message
			logger.log('debug', '   forwarding to "'+name+'": '+guest.address);

			// and submit the data
			esock.send(buffer, 0, buffer.length, guest.port, guest.address);
		}

		// iterare static guests
		for(var name in config.staticGuests)
			forward(name, staticGuests[name]);

		// iterare dynmaic guests
		for(var name in guests)
			forward(name, guests[name]);
	});

	// periodic retransmit/broadcast
	if(config.broadcastInterval > 0 && Object.keys(config.staticGuests).length > 0)
	{
		setInterval(function() {
			logger.log('info', 'broadcasting complete internal state to static guests');
			var buffer = generateBundleBuffer();

			// iterare static guests
			for(var name in config.staticGuests)
			{
				var guest = config.staticGuests[name];
				esock.send(buffer, 0, buffer.length, guest.port, guest.address);
			}

		}, config.broadcastInterval*1000);
	}
}



// test a message-address against the list of configured filters
function isMessageFiltered(messageAdress)
{
	// iterate over all filters
	for(var name in config.messageFilter)
	{
		var filter = config.messageFilter[name];
		
		// if the filter is a string
		if(typeof filter == 'string')
		{
			// test for equality
			if(filter == messageAdress)
				return name;
		}

		// if the filter is a regex
		else if(typeof filter == 'object' && filter instanceof RegExp)
		{
			// test for a match
			if(filter.test(messageAdress))
				return name;
		}

		// if the filter is a function
		else if(typeof filter == 'function')
		{
			// call that function and interpret the results as boolean
			if(!filter(messageAdress))
				return name;
		}
	}

	// no match
	return false;
}

function generateBundleBuffer()
{
	var elements = [];
	for(var address in state)
	{
		elements.push({
			oscType: "message",
			address: address,
			args: state[address].args
		})
	};

	var buffer = osc.toBuffer({
		oscType: "bundle",
		elements: elements
	});

	return buffer;
}
