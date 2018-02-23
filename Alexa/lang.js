'use strict'

exports.Language = {
	Introduction: {
		AllInfoGathered: 'Alright, that’s everything we need to get started. I’ve begun recording your sleep data now. When you come back, you can ask questions like "ask good sleep how is the bedroom?" or "ask good sleep how was the temperature last night".',
		NeedPinCode: 'Welcome to Good Sleep! I need the 4 digit pin code from your monitoring device to get started. Please say it now.',
		NeedPinCodeReprompt: 'Please say the 4 digit pin code you received when setting up your device.',
		Help: 'Welcome to Good Sleep! I can give you information about the current environment of your bedroom, or show you what the conditions were like last night or over the last week. What would you like to know?',
		HelpPreSetup: 'I can give you information about the current environment of your bedroom, but first you must complete the setup questions. ',
		HelpReprompt: 'What would you like to know?',
		Unhandled: 'Sorry, I didn’t understand that. Please say it again.',
	},
	TimeEntry: {
		SleepTime: 'I’ve connected to your device successfully. Around what time do you go to sleep?',
		WakeWeekdayTime: 'Okay. And around when do you wake up on weekdays?',
		WakeWeekendTime: 'What time do you wake up on weekends?',
		TimeZone: 'Finally, what time zone are you in? Say something like C.S.T. or Pacific Time.',
		TimeZoneError: 'I didn’t understand that time zone. Try saying something like Central Time or P.S.T. Only North American time zones are supported currently.',
		FormatError: 'Please say your time, like 9pm or 7am.',
	},
	Summary: {
		General: (element, avgValue, band, isPresent) => 'The ' + element + (isPresent ? random(' is around ', ' is about ') : random(' averaged ', ' stayed around ', ' was about ')) + avgValue + ', which is '+band+'.',
		Band: (qualifier, element, value, higherLower, isPresent) => 'The '+qualifier+' '+element+(isPresent ? ' is ' : ' was ')+value+', which is '+higherLower+' than '+random('most people like.', 'recommended.', 'desired for the best sleep.'),
		Spike: (time, element, value, band) => 'At '+time+', the '+element+' got to '+value+', which is '+band+' '+random('to sleep well.', 'and may wake you up.', 'to have a good night’s sleep.'),
		AllIsWell: (present) => present ? 'The bedroom is looking good.' : 'Everything was good.',
	},
	EnterPin: {
		InputError: 'I didn’t get your pin number. Please try saying the 4-digit pin number again.',
		Error: 'There was a problem looking up your device. Please try again later.',
		ErrorTime: 'I’m sorry, I didn’t understand that PIN number. Please say the 4 digits again.',
		NoDevice: (pin) => 'I couldn’t find a device with the pin code '+pin.split('').join(', ')+'. Please check and say it again now.'
	},
	FetchData: {
		Error: 'I couldn’t connect to your device. Please make sure it’s online and set up, then try again.'
	},
	Chart: {
		Title: 'Your Sleep Data',
		Check: () => random('Check the graph I’ve made for more details.', 'See the graph for more.', 'I’ve made a chart with the details.')
	},
};

function random() {
	return arguments[Math.floor(Math.random() * arguments.length)];
}
