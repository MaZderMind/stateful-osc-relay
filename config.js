module.exports = {
	// if one device only once sends a rare value, that value will be broadcasted repeatedly in the above mentioned interval. The number of seconds configured below set's a timeout after which a rare value is removed from the relays internal state, if no other occurence of that value reaches the relay in time.
	valueStoreTimeout: 60*60, // one hour

	// the port to which your devices should send messages
	receivePort: 10001,

	// most of the time only one osc-app will run on a single ip. Therefore the relay will not transmit messsages back to the sender-ip unless you specify that flag
	transmitBack: false,

	// usually receivers will anounce themselfs via zeroconf, but you can manually specify guests here, too - fo those who haven't seen the light yet
	staticGuests: [
		//{address: 192.168.178.31, port: 10002},
	],

	// time aftze the last received announcement or message after which zeroconf-advertised guests are dropped
	guestTimeout: 60*60*12, // 12 hours

	messageFilter: {
		// filter our messages that just consists of /[0-9] which are usually TouchOSC page change messages
		pageSwap: /^\/[0-9]+$/i
	}
}
