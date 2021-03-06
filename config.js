module.exports = {
	// dynamic (via zeroconf) announced devices get a brief of all known values when they first get visible. static devices don't announce themselfs, so if they go through a restart-cycle, they will not get briefed with new data. This is where the broadcast kicks in. Every broadcastInteval seconds, the whole state is transferred to all staticGuests. Set it to 0 to disable.
	broadcastInterval: 60*15, // 15 minutes

	// the port to which your devices should send messages
	receivePort: 10001,

	// the port on which you can reach the web-ui
	webUiPort: 8001,

	// usually receivers will anounce themselfs via zeroconf, but you can manually specify guests here, too - fo those who haven't seen the light yet
	staticGuests: {
		//'Name of Device': {address: 192.168.178.31, port: 10002},
	},

	messageFilter: {
		// filter our messages that just consists of /[0-9] which are usually TouchOSC page change messages
		pageSwap: /^\/[0-9]+$/i,

		// filter out ping messages
		ping: '/ping'

		// potential complex filter
		//complex: function(msg) { return msg == '/foo' ? true : false; }
	}
}
