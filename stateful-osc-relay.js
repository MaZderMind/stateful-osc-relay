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
	bonjour = require('bonjour')(),

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

	// logging
	debug = require('debug')('osc-relay'),

	// address classification
	Address4 = require('ip-address').Address4,
	Address6 = require('ip-address').Address6,

	// communication port for web-clients
	io = null,

	// collect a list of available ip adresses for each local interface
	addresses = [],

	// list of currently known presets
	presets = {},

	// currently connected guests by name
	guests = {},

	// having a little state is also a good idea
	state = {};


debug('Starting up the System');

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
			if(ifAddressInfo.internal)
				return;

			var a4 = new Address4(ifAddressInfo.address);
			if(!a4.isValid())
				return;

			addresses.push({ifName: ifName, address: ifAddressInfo.address});
		});
	};

	debug('enumerated', addresses.length, 'non-internal local ip adresses on', Object.keys(interfaces).length, 'network interfaces');
}



// show a welcome message with useful information
function showWelcomeMessage()
{
	// print that list and the configured port for the users convinience
	debug('printing a nice message for the users convinience');
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
	debug("Advertising our relay via Zeroconf");

	// advertise our relay service
	bonjour.publish({
		type: 'osc',
		protocol: 'udp',
		port: config.receivePort,
		name: 'Stateful OSC-Relay on '+os.hostname()
	});

	// advertise our WebUI
	bonjour.publish({
		type: 'http',
		protocol: 'tcp',
		port: config.webUiPort,
		name: 'WebUI of Stateful OSC-Relay on '+os.hostname()
	})
}



// start an mdns-browser, watching for osc compatible guests
function startGuestBrowser()
{
	var browser = bonjour.find({type: 'osc', protocol: 'udp'});

	// wait for ZeroConf events
	debug('looking for new guests using ZeroConf');

	// on servide up
	browser.on('up', function(service)
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

		// test if the advertisement is our own from a lo-interface
		if(
			service.addresses.indexOf('127.0.0.1') !== -1 &&
			service.addresses.indexOf('::1') &&
			service.port === config.receivePort
		) return;

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
			guests[service.name].lastSeen = new Date();

			// do nothing more
			return;
		}

		// select the first non-link-local address
		var selectedAdress = null;
		debug('guest announced', service.addresses.length, 'addresses:', service.addresses);
		for(var idx in service.addresses)
		{
			var address = service.addresses[idx];
			debug('testing', address);

			var a4 = new Address4(address);
			if(a4.isValid()) {
				debug('is valid v4 address, selecting');
				selectedAdress = address;
				break;
			}
		}

		if(!selectedAdress)
		{
			debug('no valid ipv4-address found');
			return;
		}

		// build a new guest record
		var guest = {
			address: selectedAdress,
			port: service.port,
			lastSeen: new Date()
		}

		// save the guest-record in the guests-hash
		guests[service.name] = guest;

		// print another message
		debug('guest "'+service.name+'" up:', guest.address, guest.port, '(now '+Object.keys(guests).length+' guests)');

		// notify the web-ui clients
		updateWebUi('guest-up');

		// brief the new guest with our internal state
		debug('  briefing new guest with '+Object.keys(state).length+' values')
		var buffer = generateBundleBuffer();
		esock.send(buffer, 0, buffer.length, guest.port, guest.address);
	});
	
	// on service down
	browser.on('down', function(service)
	{
		// unknwon service
		if(!guests[service.name])
			return;

		// save state for a short time and delete from guest hash
		var guest = guests[service.name];
		delete guests[service.name];

		// print a message
		debug('guest "'+service.name+'" down:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');

		// notify the web-ui clients
		updateWebUi('guest-down');
	});

	// start the browser
	browser.start();
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

	io.sockets.on('connection', function(socket)
	{
		// brief fresh connected web-ui clients
		socket.emit('update', 'initial', buildWebUiUpdateBundle())

		// event handlers
		socket.on('newPreset', function(name)
		{
			debug('writing new preset with name', name, 'and', Object.keys(state).length, 'values');

			var jsonStr = JSON.stringify(state, null, "\t");
			console.log(jsonStr);
			fs.writeFile(path.join('presets', name+'.json'), jsonStr, {encoding: 'utf8'}, function(err) {
				if(err)
					return debug('error writing preset-file', err);

				if(!presets[name])
					presets[name] = 'new';

				updateWebUi('new preset');
			})
		});

		socket.on('deletePreset', function(name)
		{
			debug('deleting preset with name', name);

			fs.unlink(path.join('presets', name+'.json'), function(err) {
				if(err)
					return debug('error deleting preset-file', err);

				delete presets[name];

				updateWebUi('deleted preset');
			})
		});

		socket.on('loadPreset', function(name)
		{
			debug('loading preset with name', name);

			fs.readFile(path.join('presets', name+'.json'), {encoding: 'utf8'}, function(err, data) {
				if(err)
					return debug('error reading preset-file', err);

				try {
					var preset = JSON.parse(data)
				}
				catch(e) {
					return debug('error parsing preset-file', name+'.json', e);
				}

				// update state
				state = preset;

				// send an update to all guests
				var buffer = generateBundleBuffer();

				// iterare static guests
				for(var guestname in config.staticGuests)
				{
					var guest = config.staticGuests[guestname];
					debug('   forwarding to "'+guestname+'": '+guest.address);
					esock.send(buffer, 0, buffer.length, guest.port, guest.address);
				}

				// iterare dynamic guests
				for(var guestname in guests)
				{
					var guest = guests[guestname];
					debug('   forwarding to "'+guestname+'": '+guest.address);
					esock.send(buffer, 0, buffer.length, guest.port, guest.address);
				}

				// update preset state and show in WebUI
				presets[name] = 'used';
				updateWebUi('preset used');
			})
		});

		socket.on('removeState', function(messages) {
			debug('removing', messages.length || 'all', 'of', Object.keys(state).length, 'messages from internal state');

			if(messages.length)
			{
				for (var i = 0, l = messages.length; i < l; i++) {
					delete state[messages[i]];
				};
			}
			else state = [];

			updateWebUi('removed message');
			debug(Object.keys(state).length, 'messages in internal state left');
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
		debug('lesscss recompile '+lessfile+' -> '+cssfile);

		fs.readFile(lessfile, {encoding: 'utf8'}, function(err, lesscode)
		{
			if(err)
				return debug('lesscss error: unable to read less file ' + lessfile, err)

			less.render(
				lesscode,
				{
					compress: true,
					relativeUrls: true,
					paths: [path.dirname(lessfile)]
				},
				function(err, csscode) {
					if(err)
						return debug('lesscss error', less.formatError(err))

					fs.writeFile(cssfile, csscode.css, {encoding: 'utf8'}, function(err) {
						if(err)
							return debug('unable to write css file ' + cssfile, err);
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

	// reset preset-state
	for(var preset in presets)
		presets[preset] = '';
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
			n: name,
			t: guest.lastSeen.getTime()
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
		p: presets,
		m: Object.keys(state)
	}
}


function loadPresets()
{
	debug('loading presets');
	fs.readdir('presets/', function(err, files) {
		files.forEach(function(file) {
			path.parse
			if(path.extname(file) == '.json')
			{
				presets[path.basename(file, '.json')] = '';
			}
		})

		debug('loaded', Object.keys(presets).length,'presets');
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
			return debug('message parse error', e);
		}

		// catch bogus messages
		if(!message.address)
			debug('received bogus message from '+rinfo.address+' (no address)');

		// print some message
		debug('received message from '+rinfo.address+':', message.address, 'with', (message.args ? message.args.length : 0), 'arg(s)');

		// test if the message matches one of the filters
		var filterResult = isMessageFiltered(message.address);
		if(filterResult !== false)
			return debug('   filtered -> ', filterResult);

		// message is new - inform WebUi
		var isNew = !state[message.address];

		// save the message and its arguments in our internal state array
		state[message.address] = {
			args: message.args
		}

		// forward message to one of the guests
		function forward(name, guest)
		{
			// print a message
			debug('   forwarding to "'+name+'": '+guest.address);

			// and submit the data
			esock.send(buffer, 0, buffer.length, guest.port, guest.address);
		}

		// iterare static guests
		for(var name in config.staticGuests)
		{
			if(staticGuests[name].address != rinfo.address)
				forward(name, staticGuests[name]);
		}

		// iterare dynamic guests
		for(var name in guests)
		{
			if(guests[name].address != rinfo.address)
				forward(name, guests[name]);

			// we have no way in determining which guest this message came from (-> random udp sending ports)
			// but we can update the lastSeen stamp on all guests on that ip address
			//  TODO test if we can somehow target this with the mdsn module
			if(guests[name].address == rinfo.address)
				guests[name].lastSeen = new Date();
		}

		if(isNew)
			updateWebUi('new message');
	});

	// dynamic guests get their brief when they come up. with static guests we don't know ehn they go down or up,
	// so we'll shedule a periodic retransmit/broadcast
	if(config.broadcastInterval > 0 && Object.keys(config.staticGuests).length > 0)
	{
		setInterval(function() {
			debug('broadcasting complete internal state to static guests');
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
