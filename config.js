module.exports = {
	// if one device only once sends a rare value, that value will be broadcasted repeatedly in the above mentioned interval. The number of seconds configured below set's a timeout after which a rare value is removed from the relays internal state, if no other occurence of that value reaches the relay in time. set to 0 to disable.
	valueStoreTimeout: 60*60, // one hour

	// dynamic (via zeroconf) announced devices get a brief of all known values when they first get visible. static devices don't announce themselfs, so if they go through a restart-cycle, they will not get briefed with new data. This is where the broadcast kicks in. Every broadcastInteval seconds, the whole state is transferred to all staticGuests. Set it to 0 to disable.
	broadcastInterval: 60*15, // 15 minutes

	// the port to which your devices should send messages
	receivePort: 10001,

	// the port on which you can reach the web-ui
	webUiPort: 8001,

	// most of the time only one osc-app will run on a single ip. Therefore the relay will not transmit messsages back to the sender-ip unless you specify that flag
	transmitBack: false,

	// usually receivers will anounce themselfs via zeroconf, but you can manually specify guests here, too - fo those who haven't seen the light yet
	staticGuests: [
		//{address: 192.168.178.31, port: 10002},
	],

	// time aftze the last received announcement or message after which zeroconf-advertised guests are dropped. set to 0 to disable.
	guestTimeout: 60*60*12, // 12 hours

	messageFilter: {
		// filter our messages that just consists of /[0-9] which are usually TouchOSC page change messages
		pageSwap: /^\/[0-9]+$/i,

		// filter out ping messages
		ping: '/ping'

		// potential complex filter
		//complex: function(msg) { return msg == '/foo' ? true : false; }
	}
}
