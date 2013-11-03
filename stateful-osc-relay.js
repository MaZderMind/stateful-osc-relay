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

	// collect a list of available ip adresses for each local interface
	addresses = listLocalAdresses(),

	// currently connected guests by name
	guests = {},

	// having a little state is also a good idea
	state = {};



// show a welcome message with useful information
showWelcomeMessage();

// advertise our osc-service
advertiseService();

// start an mdns-browser, watching for osc compatible guests
startGuestBrowser();

// start the relay operation
startRelay();



/// implementation


// collect a list of available ip adresses for each local interface
function listLocalAdresses()
{
	var
		interfaces = os.networkInterfaces(),
		addresses = [];

	// iterate all interfaces by name
	for(ifName in interfaces)
	{
		// iterate all adresses of these interface
		interfaces[ifName].forEach(function(ifAddressInfo)
		{
			// collect external ipv4 adresses
			if(ifAddressInfo.family == 'IPv4' && !ifAddressInfo.internal)
				addresses.push({ifName: ifName, address: ifAddressInfo.address});
		});
	};

	return addresses;
}



// show a welcome message with useful information
function showWelcomeMessage()
{
	// print that list and the configured port for the users convinience
	console.log("Configure your OSC-Clients like this:")
	if(addresses.length == 0)
	{
		console.log("  Host:         [can't find your ip - sorry]");
	}
	else if(addresses.length == 1)
	{
		console.log("  Host:         ", addresses[0].address);
	}
	else
	{
		console.log("  Host:");
		addresses.forEach(function(address) {
			console.log("    "+address.ifName+': '+address.address);
		});
	}

	console.log("  Outgoing Port:", config.receivePort);
	console.log("");
}



// advertise our osc-service
function advertiseService()
{
	console.log("Advertising our relay via Zeroconf");

	// advertise our relay service
	mdns.createAdvertisement(
		mdns.udp('osc'),
		config.receivePort,
		{
			name: 'Stateful OSC-Relay on '+os.hostname()
		}
	).start();
}



// start an mdns-browser, watching for osc compatible guests
function startGuestBrowser()
{
	var  mdnsBrowser = mdns.createBrowser(mdns.udp('osc'));

	// wait for ZeroConf events
	console.log('looking for new guests using ZeroConf')

	// on servide up
	mdnsBrowser.on('serviceUp', function(service)
	{
		// sometimes an andvertisement without an address comes through..
		if(service.addresses && service.addresses.length == 0)
			return;

		// test all our own adresses to filter out our own advertisement
		for(idx in addresses)
		{
			var address = addresses[idx];
			if(service.addresses.indexOf(address.address) !== -1 && service.port === config.receivePort)
				return;
		}

		// test all static configured guests and ignore their advertisements
		for(idx in config.staticGuests)
		{
			var address = guests[idx];
			if(service.addresses.indexOf(address.address) !== -1 && service.port === address.port)
				return;
		}

		// ignore known guests
		if(guests[service.name])
		{
			// update guest timeout
			var guest = guests[service.name];

			clearTimeout(guest.timeout);
			guest.timeout = setTimeout(function() {
				// save state for a short time and delete from guest hash
				delete guests[service.name];

				// print a message
				console.log('guest "'+service.name+'"  timeouted after ', config.guestTimeout, 'seconds:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');
			}, config.guestTimeout * 1000);

			// do nothing more
			return;
		}

		// build a new guest record
		var guest = {
			address: service.addresses[0],
			port: service.port,
			
			// timeout function
			timeout: setTimeout(function() {
				// save state for a short time and delete from guest hash
				var guest = guests[service.name];
				delete guests[service.name];

				// print a message
				console.log('guest "'+service.name+'"  timeouted after ', config.guestTimeout, 'seconds:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');
			}, config.guestTimeout * 1000)
		};

		// save the guest-record in the guests-hash
		guests[service.name] = guest;

		// print another message
		console.log('guest "'+service.name+'" up:', service.addresses[0], service.port, '(now '+Object.keys(guests).length+' guests)');

		// brief the new guest with our internal state
		// TODO: evaluate the use of a combined osc message
		console.log('  briefing new guest with '+Object.keys(state).length+' values')
		for(address in state)
		{
			var buffer = osc.toBuffer({
				address: address,
				args: state[address].args
			});

			esock.send(buffer, 0, buffer.length, guest.port, guest.address);
		};
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
		console.log('guest "'+service.name+'" down:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');
	});

	// start the browser
	mdnsBrowser.start();
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
			return console.log('message parse error', e);
		}

		// print some message
		console.log('received message from '+rinfo.address+':', message.address, 'with', message.args.length, 'arg(s)');

		// test if the message matches one of the filters
		var filterResult = isMessageFiltered(message.address);
		if(filterResult !== false)
			return console.log('   filtered -> ', filterResult);

		// clear previous timeouts
		if(state[message.address])
			clearTimeout(state[message.address].timeout);

		// save the message and its arguments in our internal state array
		state[message.address] = {
			args: message.args,
			timeout: setTimeout(function()
			{
				console.log('removing message', message.address, 'from internal state');
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
				clearTimeout(guest.timeout);
				guest.timeout = setTimeout(function() {
					// save state for a short time and delete from guest hash
					delete guests[name];

					// print a message
					console.log('guest "'+name+'"  timeouted after ', config.guestTimeout, 'seconds:', guest.address, guest.port, '('+Object.keys(guests).length+' guests left)');
				}, config.guestTimeout * 1000);

				// if the configurations restricts back-transmissions - stop here
				if(!config.transmitBack) return;
			}

			// print a message
			console.log('   forwarding to "'+name+'": '+guest.address);

			// and submit the data
			esock.send(buffer, 0, buffer.length, guest.port, guest.address);
		}

		// iterare static guests
		for(name in config.staticGuests)
			forward(name, staticGuests[name]);

		// iterare dynmaic guests
		for(name in guests)
			forward(name, guests[name]);
	});
}



// test a message-address against the list of configured filters
function isMessageFiltered(messageAdress)
{
	// iterate over all filters
	for(name in config.messageFilter)
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
