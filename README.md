# Stateful OpenSoundControl (OSC) Relay =

## About OpenSoundControl
OpenSoundControl (OSC) is a amall and lightweight remote control protocol. I'ts somehow the successor of midi. It consists of messages one device sends to another. For example an iPad with the [TouchOSC](http://hexler.net/software/touchosc) Software can control an [https://www.ableton.com/de/live/ AbletonLive] on your Computer or directly Controle [some Hardware](http://wifimidi.com/). That all works out fine as long as only one Device is controlling one other, but if you have multiple Receivers and multiple Devices you'll need a relay like [Osculator](http://www.osculator.net/).

## About State
But that only solves half of the Problem. If a Device joins the Relay late (ie you change some parameters with TouchOSC from you iPhone and start your iPad afterwards), they will be out of state. The iPad does now know, which value the iPhone has changed previously and there is no way it can query for that information. This Problem shall be solved with the piece of software in front of you.

## About the Stateful OSC Relay
This implementation of an OSC Relay adds some state to the whole OSC chain. It auto-discovers OSC-Compatible devices via [Zeroconf](http://en.wikipedia.org/wiki/Zero-configuration_networking) and briefs them with its own knowledge of the state the whole OSC Network has. Whenever a device sends a message to the relay, the relay stores it into its internal state while at the same time relaying it to all known guest-devices. When a new guest joins, the relay sends it a brief overview of all values in the relays internal state. This way all devices should at all times have the same view on the state of the OSC Network.

## About Zeroconf & Static Guests
Zeroconf is a way to auto-discover devices that offer a specific service such as OSC-Capable devices. If your device or software does not announce itsself als such via Zeroconf, you can configure its adress and port as static guests in the config.js-File. As none-Zeroconf-Devices doesn't announce their availability to the relay, they can't get an automated briefing from it. The relay regularly (default: every 15 minutes) broadcasts its internal state to all staticly configured guests to overcome this.

## About Timeouts
The relay has various timeouts directed at not flooding your network. First of all if a zeroconf discovered gues is not active for guestTimeout seconds (default: 12 hours), it will be removed from the list of avaiable guests. Second, messages in the internal state are discarded after some period of time (default: one hour). All Intervals and Timeouts can be configured and disabled in the config.

## About Filters
Some Messages are nonsense. TouchOSC regularly submits a ``/ping``-Message and also transmits a ```/page/[0-9]+``` message each time you switch to another page in the gui. Such messages can be filtered via filter-rules in the configuration.

## About me
I'm Peter Körner from Germany. If you have any questions just ask at peter@mazdermind.de.
