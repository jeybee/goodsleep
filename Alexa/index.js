'use strict';

const AWS = require('aws-sdk');
const Alexa = require('alexa-sdk');
const http = require('http');
const LZString = require('lz-string');
const moment = require('moment-timezone');

const appId = 'amzn1.ask.skill.d5052a73-e0f6-4e20-80a4-bf056b57d50c';
const dynamoDbTable = 'SleepMonitor';
const dynamoDbLinkTable = 'sleepMonitorLink';
const AWSregion = 'us-east-1';
const APIGatewayAddress = 'https://y0pths7tg4.execute-api.us-east-1.amazonaws.com/prod/chart';

const makePlainText = Alexa.utils.TextUtils.makePlainText;
const makeRichText = Alexa.utils.TextUtils.makeRichText;
const makeImage = Alexa.utils.ImageUtils.makeImage;

AWS.config.update({region: AWSregion});
var docClient = new AWS.DynamoDB.DocumentClient();

// Import our strings file
const Language = require('lang').Language;

// Possible states we can jump in to, for collecting information
const states = {
    EnterPinMode: 'EnterPinMode',
    TimeResponseMode: 'TimeResponseMode',
    SetTimeZoneMode: 'SetTimeZoneMode',
};

// Types of data we can be waiting for
const waitingStates = {
    Sleep: 'Sleep',
    WakeWeekday: 'WakeWeekday',
    WakeWeekend: 'WakeWeekend',
}

// Elements of the room that users can ask about
const elements = {
    Room: 'room',
    Light: 'brightness',
    Sound: 'sound level',
    Humidity: 'humidity',
    Temperature: 'temperature'
}

const units = {};
units[elements.Room] = '';
units[elements.Light] = ' lux';
units[elements.Sound] = ' decibels';
units[elements.Humidity] = ' percent';
units[elements.Temperature] = ' degrees';

// Bands labels for each datapoint
var labels = {
    BandVeryLow: -3,
    BandTooLow: -2,
    BandSlightlyLow: -1,
    BandIdeal: 0,
    BandSlightlyHigh: 1,
    BandTooHigh: 2,
    BandVeryHigh: 3,
}

var bands = {};

// Temperature bands
bands[elements.Temperature] = {
    BandVeryLow: [0, 52],
    BandTooLow: [53, 55],
    BandSlightlyLow: [56, 58],
    BandIdeal: [59, 70],
    BandSlightlyHigh: [71, 72],
    BandTooHigh: [73, 75],
    BandVeryHigh: [76],
};

// Humidity bands
bands[elements.Humidity] = {
    BandTooLow: [0, 30],
    BandSlightlyLow: [31, 41],
    BandIdeal: [42, 60],
    BandSlightlyHigh: [60, 67],
    BandTooHigh: [68],
};

// Light bands
bands[elements.Light] = {
    BandIdeal: [0, 2],
    BandSlightlyHigh: [3, 10],
    BandTooHigh: [11, 30],
    BandVeryHigh: [31],
};

// Sound bands
bands[elements.Sound] = {
    BandIdeal: [0, 25],
    BandSlightlyHigh: [26, 39],
    BandTooHigh: [40],
};

exports.handler = function(event, context) {
    // Set up the Alexa handler
    const alexa = Alexa.handler(event, context);
    alexa.appId = appId;
    alexa.dynamoDBTableName = dynamoDbTable;
    alexa.saveBeforeResponse = true;
    alexa.registerHandlers(sessionHandlers, enterPinHandlers, timeResponseHandlers, timeZoneResponseHandlers);

    alexa.execute();
};

const sessionHandlers = {
    // For debugging
    'Reset': function() {
        delete this.attributes.guid;
        delete this.attributes.ip;
        delete this.attributes.port;
        delete this.attributes.wakeWeekdayTime;
        delete this.attributes.wakeWeekendTime;
        delete this.attributes.sleepTime;
        delete this.attributes.timeZone;
        this.emit(':tell', 'Done');
    },
    'LaunchRequest': function() {
        if (!this.attributes) {
            this.attributes = {};
        }

        this.emit('IntroChecks');
    },
    'IntroChecks': function(prefix='') {
        // We check first to see if we have connected to the Arduino device
        if (!hasStoredGuid.call(this)) {
            this.handler.state = states.EnterPinMode;
            this.emit(':ask', prefix+Language.Introduction.NeedPinCode, Language.Introduction.NeedPinCodeReprompt);
        }
        // Then we gather various personal information
        else if (!hasSleepTime.call(this)) {
            this.handler.state = states.TimeResponseMode;
            this.attributes.waitingState = waitingStates.Sleep;
            this.emit(':ask', prefix+Language.TimeEntry.SleepTime, Language.TimeEntry.SleepTime);
        }
        else if (!hasWakeWeekdayTime.call(this)) {
            this.handler.state = states.TimeResponseMode;
            this.attributes.waitingState = waitingStates.WakeWeekday;
            this.emit(':ask', prefix+Language.TimeEntry.WakeWeekdayTime, Language.TimeEntry.WakeWeekdayTime);
        }
        else if (!hasWakeWeekendTime.call(this)) {
            this.handler.state = states.TimeResponseMode;
            this.attributes.waitingState = waitingStates.WakeWeekend;
            this.emit(':ask', prefix+Language.TimeEntry.WakeWeekendTime, Language.TimeEntry.WakeWeekendTime);
        }
        else if (!hasTimeZone.call(this)) {
            this.handler.state = states.SetTimeZoneMode;
            this.emit(':ask', prefix+Language.TimeEntry.TimeZone, Language.TimeEntry.TimeZone);
        }
        // If we have all that, we read the usual intro message
        else {
            resetState.call(this);
            this.emit('AMAZON.HelpIntent');
        }
    },
    'SpecificStatus': function() {
        // If we haven't done set up, jump to the intro first
        if (!hasAllPersonalInfo.call(this)) {
            this.emit('IntroChecks');
            return;
        }

        // Get the date and type of room element requested
        var slots = getSlotValues(this.event.request.intent.slots);
        var element = slots.Element.resolved;
        var date = slots.RequestDate.resolved;
        var validElements = ['temperature', 'humidity', 'sound', 'light', 'room'];

        if (date == 'is' || date == 'is now' || date == 'is like now' || !date || date == '') {
            date = 'today';
        }

        if (element == elements.Room || !validElements.includes(element)) {
            element = undefined;
        }

        // Make a call to the Arduino device to fetch the data, and a chart URL
        retrieveDataWithOptions.call(this, element, date, (data, err) => {
            if (err) {
                // If something went wrong, bail out with an error to the user
                console.log("Error: "+err);
                this.emit(':say', Language.FetchData.Error);
                return;
            }

            // Process, reverse and cleanup the data
            var temp = data.t.split(',').clean('').map(x => parseInt(x)).reverse();
            var humidity = data.h.split(',').clean('').map(x => parseInt(x)).reverse();
            var sound = data.s.split(',').clean('').map(x => parseInt(x)).reverse();
            var light = data.l.split(',').clean('').map(x => parseInt(x)).reverse();
            var timestamps = data.ts.split(',').clean('').map(x => parseInt(x)).reverse();

            data = {t:temp, h:humidity, s:sound, l:light, ts:timestamps};

            // Summarise the data we received
            var summary = produceDataSummary.call(this, data, date, element); 

            // Now create a URL for the chart service based off the data we received
            var isHours = date == 'today' || date == 'yesterday'; 
            var chartURL = produceChartURL.call(this, data, isHours, element);

            // If you're on an Echo device with a screen, we can show your chart directly
            if (supportsDisplay.call(this)) {
                const builder = new Alexa.templateBuilders.BodyTemplate7Builder();

                var template = builder.setBackButtonBehavior('HIDDEN')
                                    .setBackgroundImage(makeImage('https://s3.amazonaws.com/sleepmonitor/chart_bg.png', null, null, null, 'Gradient background'))
                                    .setTitle(Language.Chart.Title)
                                    .setImage(makeImage(chartURL, null, null, null, 'Chart of your sleep data'))
                                    .build();

                this.response.renderTemplate(template);

                summary += ' '+Language.Chart.Check();
            }

            // Make a card in the Alexa mobile app for devices without screens
            this.response.cardRenderer(Language.Chart.Title, summary, {
                smallImageUrl: null,
                largeImageUrl: chartURL,
            });
            
            this.response.speak(summary);
            this.emit(':responseReady');
        });
    },
    'AMAZON.CancelIntent': function() {
        this.emit(':responseReady');
    },
    'AMAZON.StopIntent': function() {
        this.emit(':responseReady');
    },
    'AMAZON.HelpIntent': function() {
        if (!hasAllPersonalInfo.call(this)) {
            this.emit('IntroChecks', Language.Introduction.HelpPreSetup);
            return;
        }

        this.emit(':ask', Language.Introduction.Help, Language.Introduction.HelpReprompt);
    },
    'Unhandled': function() {
        this.emit(':ask', Language.Introduction.Unhandled);
    },
    'SessionEndedRequest': function() {
        delete this.attributes.ip;
        delete this.attributes.port;
        resetState.call(this);
        this.emit(':responseReady');
    }
};

// Handlers for when we are waiting for the PIN to be said
const enterPinHandlers = Alexa.CreateStateHandler(states.EnterPinMode, {
    'EnterPin': function() {
        var slots = getSlotValues(this.event.request.intent.slots);
        var pin = slots.PinNumber.resolved;
        this.emitWithState('ValidatePin', pin);
    },
    'ValidatePin': function(pin) {
        // If we didn't get a PIN then bail out
        if (!pin || pin == '') {
            this.emit(':ask', Language.EnterPin.InputError);
            return;
        }

        // Connect to link service to lookup GUID and IP:port from the PIN
        retrieveGuidWithPin(pin, (guid, ip, port, err) => {
            if (err) {
                // We failed for some reason, so bail out
                console.log('Error retrieving GUID: '+err);
                this.emit(':tell', Language.EnterPin.Error);
                return;
            }
            else if (!guid) {
                this.emit(':ask', Language.EnterPin.NoDevice(pin));
                return;
            }

            // Store GUID and IP:port in the attributes that will be saved for future
            this.attributes.guid = guid;
            this.attributes.ip = ip;
            this.attributes.port = port;

            // Jump back to the intro to fetch the other personal data
            this.emit("IntroChecks");
        });
    },
    'TimeResponse': function() {
        // If we got a TimeReponse intent incorrectly, ask for the PIN again
        this.emit(':ask', Language.EnterPin.ErrorTime);
    },
    'LaunchRequest': function() {
        // If we are in this state, we want to jump back to the default state
        resetState.call(this);
        this.emit('LaunchRequest');
    },
    'Unhandled': function() {
        if (!hasAllPersonalInfo.call(this)) {
            this.emit('IntroChecks');
            return;
        }

        this.emit('Unhandled');
    },
    'AMAZON.CancelIntent': function() {
        this.emit('AMAZON.CancelIntent');
    },
    'AMAZON.StopIntent': function() {
        this.emit('AMAZON.StopIntent');
    },
    'AMAZON.HelpIntent': function() {
        this.emit('AMAZON.HelpIntent');
    },
    'SessionEndedRequest': function() {
        this.emit('SessionEndedRequest');
    }
});

// Handlers for when we are waiting for a time response
const timeResponseHandlers = Alexa.CreateStateHandler(states.TimeResponseMode, {
    'TimeResponse': function() {
        // If we got a TimeResponse intent unexpectedly, jump back to 
        // the start state
        if (!this.attributes.waitingState)  {
            resetState.call(this);
            this.emit('LaunchRequest');
            return;
        }

        // Get spoken time value
        var slots = getSlotValues(this.event.request.intent.slots);
        var timeEntered = slots.SleepTime.resolved;
        console.log('Time entered: '+timeEntered);

        // If the user used one of the valid values "morning", "night" etc.
        // then ask them to say it as a specific time
        if (["NI", "MO", "AF", "EV"].includes(timeEntered)) {
            this.emit(':ask', Language.TimeEntry.FormatError, Language.TimeEntry.FormatError);
            return;
        }

        // Fill out the correct time based on what we were waiting for
        switch (this.attributes.waitingState) {
            case waitingStates.Sleep:
                this.attributes.sleepTime = timeEntered;
                break;
            case waitingStates.WakeWeekday:
                this.attributes.wakeWeekdayTime = timeEntered;
                break;
            case waitingStates.WakeWeekend:
                this.attributes.wakeWeekendTime = timeEntered;
                break;
        }

        // We're done waiting for this piece, so delete it
        delete this.attributes.waitingState;

        this.emit('IntroChecks');
    },
    'LaunchRequest': function() {
        // If we are in this state, we want to jump back to the default state
        resetState.call(this);
        this.emit('LaunchRequest');
    },
    'Unhandled': function() {
        if (!hasAllPersonalInfo.call(this)) {
            this.emit('IntroChecks');
            return;
        }

        this.emit('Unhandled');
    },
    'AMAZON.CancelIntent': function() {
        this.emit('AMAZON.CancelIntent');
    },
    'AMAZON.StopIntent': function() {
        this.emit('AMAZON.StopIntent');
    },
    'AMAZON.HelpIntent': function() {
        this.emit('AMAZON.HelpIntent');
    },
    'SessionEndedRequest': function() {
        this.emit('SessionEndedRequest');
    }
});

// Handlers for when we are waiting for a timezone
const timeZoneResponseHandlers = Alexa.CreateStateHandler(states.SetTimeZoneMode, {
    'SetTimeZone': function() {
        // Get spoken time value
        var slots = getSlotValues(this.event.request.intent.slots);
        var timeZone = slots.TimeZone.resolved;
        console.log('Time zone: '+timeZone);

        var validTimezones = ['PST', 'PDT', 'MST', 'MDT', 'HST', 'HDT', 'EST', 'EDT', 'CST', 'CDT', 'AKST', 'AKDT'];

        // If we didn't get a valid time zone then ask again
        if (!timeZone || !validTimezones.includes(timeZone)) {
            this.emit(':ask', Language.TimeEntry.TimeZoneError, Language.TimeEntry.TimeZoneError);
            return;
        }

        this.attributes.timeZone = timeZone;

        // Check if we have all the information required, and finish if so
        if (hasAllPersonalInfo.call(this)) {
            resetState.call(this);
            this.emit(':tell', Language.Introduction.AllInfoGathered);
        }
        // Otherwise, go back to get more information
        else {
            this.emit('IntroChecks');
        }
    },
    'LaunchRequest': function() {
        // If we are in this state, we want to jump back to the default state
        resetState.call(this);
        this.emit('LaunchRequest');
    },
    'Unhandled': function() {
        if (!hasAllPersonalInfo.call(this)) {
            this.emit('IntroChecks');
            return;
        }

        this.emit('Unhandled');
    },
    'AMAZON.CancelIntent': function() {
        this.emit('AMAZON.CancelIntent');
    },
    'AMAZON.StopIntent': function() {
        this.emit('AMAZON.StopIntent');
    },
    'AMAZON.HelpIntent': function() {
        this.emit('AMAZON.HelpIntent');
    },
    'SessionEndedRequest': function() {
        this.emit('SessionEndedRequest');
    }
});

// Fetches the device IP from DynamoDB with the GUID
function retrieveIPWithGuid(guid, callback) {
    // If we've already fetched the IP this session, then callback immediately
    if (this.attributes.ip && this.attributes.port) {
        callback(this.attributes.ip, this.attributes.port);
        return;
    }

    // Parameters for looking up item by GUID in DynamoDB
    var params = {
        TableName: dynamoDbLinkTable,
        Key: {
            guid: guid
        }
    };

    var docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-1'});

    // Make the call to DynamoDB
    docClient.get(params, (err, data) => {
        if (err) {
            console.error('Unable to read item. Error JSON:', JSON.stringify(err));
            callback(null, null, err);
        } else {
            // Save the IP/port for the session
            this.attributes.ip = data.Item.ip;
            this.attributes.port = data.Item.port;
            callback(this.attributes.ip, this.attributes.port);
        }
    });
}

// Fetches the GUID from DynamoDB with the PIN
function retrieveGuidWithPin(pin, callback) {
    // Parameters to scan the table for the matching PIN code
    var params = {
        TableName: dynamoDbLinkTable,
        FilterExpression: "#pin = :pinCode",
        ExpressionAttributeNames: {
            "#pin": "pin",
        },
        ExpressionAttributeValues: {
             ":pinCode": parseInt(pin)
        }
    };

    var docClient = new AWS.DynamoDB.DocumentClient({region: 'us-east-1'});

    docClient.scan(params, (err, data) => {
        if (err) {
            console.error('Unable to read item. Error JSON:', JSON.stringify(err));
            callback(null, null, null, err);
        } else {
            if (data.Items.length == 0) {
                callback(null, null, null, null);
                return;
            }

            // The data will be stored in the first item if we got one
            var item = data.Items[0];
            callback(item.guid, item.ip, item.port);
        }
    });
}

// List of timezone abbreviations we currently support for moment-timezone
function translateTimeZoneToLocation(tz) {
    const zones = {
        "PST": "America/Los_Angeles",
        "PDT": "America/Los_Angeles",
        "MST": "America/Denver",
        "MDT": "America/Denver",
        "HST": "Pacific/Honolulu",
        "HDT": "Pacific/Honolulu",
        "UTC": "Etc/UTC",
        "EST": "America/New_York",
        "EDT": "America/New_York",
        "CST": "America/Chicago",
        "CDT": "America/Chicago",
        "AKST": "America/Anchorage",
        "AKDT": "America/Anchorage"
    };

    return zones[tz];
}

// Fetches data from the Arduino device
function retrieveDataWithOptions(element, date, callback) {
    var path = '';
    var timezone = translateTimeZoneToLocation(this.attributes.timeZone);
    var tz = moment().tz(timezone);
    
    // Turn requested time period in to min and max timestamp using user timezone
    var min = 0;
    var max = 0;
    var perHour = 1;

    if (date == 'today') {
        // Last 12 hours
        max = tz.format('X');
        min = tz.subtract(8, 'hours').startOf('hour').format('X');
        perHour = 6;
    } else if (date == 'yesterday') {
        // From 9pm yesterday to 11am today
        max = tz.startOf('day').add(11, 'hours').format('X');
        min = moment().tz(timezone).subtract(1, 'days').startOf('day').add(21, 'hours').format('X');
        perHour = 6;
    } else {
        // From now to 7 days ago
        max = tz.format('X');
        min = tz.subtract(7, 'days').format('X');
        perHour = 1;
    }

    path = 'min='+min+'&max='+max+'&ph='+perHour;

    console.log('Path: '+path);
    
    // First we need to grab the IP address
    retrieveIPWithGuid.call(this, this.attributes.guid, (ip, port, err) => {
        if (err) {
            callback(null, err);
            return;
        }

        // Set up the HTTP request to the Arduino device
        var options = {
            host: ip,
            port: port,
            path: '/fetch?'+path,
            method: 'GET'
        };

        // Make the request
        var request = http.request(options, res => {
            res.setEncoding('utf8');

            var returnData = '';

            // Set up callback for receiving the data
            res.on('data', chunk => {
                returnData = returnData + chunk;
            });

            // When we have all the data
            res.on('end', () => {
                returnData = returnData.trim();

                if (!returnData) {
                    callback(null, null, "No data was returned from the device.");
                    return;
                }

                // Parse the data from the device in to an object
                returnData = parseQueryInput(returnData);
                callback(returnData, null);
            });

        });

        request.on('error', function(err) {
            callback(null, null, err);
        });

        request.end();
    });
}

// Create X-axis timestamp labels for the data in the user's timezone
function createChartLabels(data, isHours) {
    var hourOrDay = isHours ? 'ha': 'ddd';
    var lastLabel = '';
    var timezone = translateTimeZoneToLocation(this.attributes.timeZone);
    var timestamps = data.ts;
    var output = [];

    // Take each timestamp and make labels at the boundary points where hours/days change
    timestamps.forEach((timestamp, idx) => {
        var label = moment.tz(timestamp*1000, timezone).format(hourOrDay);

        if (label != lastLabel) {
            // Add it to the labels with the index it occurred at
            output.push(idx+'='+label);
            lastLabel = label;
        }
    });

    return output.join(',');
}

// Create the chart URL based on the received data
function produceChartURL(data, isHours, element) {
    var labels = createChartLabels.call(this, data, isHours);

    var urlData = {};
    urlData.x = labels;

    if (!element || element == 'temperature') {
        urlData.t = data.t;
    }
    if (!element || element == 'humidity') {
        urlData.h = data.h;
    }
    if (!element || element == 'sound') {
        urlData.s = data.s;
    }
    if (!element || element == 'light') {
        urlData.l = data.l;
    }

    var queryString = Object.keys(urlData).map(k => `${k}=${encodeURI(urlData[k])}`).join('&');

    // Compress the chart data to fit in the query string
    var chartURL = APIGatewayAddress + '?d='+LZString.compressToEncodedURIComponent(queryString);

    //console.log("qs: "+queryString);
    //console.log("chart: "+chartURL);

    return chartURL;
}

function encodeURI(comp) {
    return encodeURIComponent(comp).replace(/%2C/g, ',');
}

// Calculates the max, min, median and avg and whether there's a spike
function calculateRangesForData(data, spikeSize, element) {
    // Make a copy of the data before we mess with it
    var calcData = data.slice();

    // Calculate indexes of maximum and minimum values
    var maxIdx = calcData.reduce((selectedIndex, value, index, array) => value > array[selectedIndex] ? index : selectedIndex, 0);
    var minIdx = calcData.reduce((selectedIndex, value, index, array) => value < array[selectedIndex] ? index : selectedIndex, 0);

    // Calculate average and median
    var avg = Math.round(calcData.reduce((a,b) => (a+b), 0) / calcData.length);
    calcData.sort((a, b) => a - b);
    var median = (calcData[(calcData.length - 1) >> 1] + calcData[calcData.length >> 1]) / 2

    // See if there's a spike
    var spikeAmount = hasDataSpike(data[maxIdx], data[minIdx], avg, spikeSize, element);

    return [maxIdx, minIdx, avg, median, spikeAmount];
}

// Checks if there's a high or low spike from the average
function hasDataSpike(max, min, avg, spikeSize, element) {
    if (max-avg > spikeSize && bandForValue(max, element) != labels.BandIdeal) {
        return max-avg;
    }
    else if (avg-min > spikeSize && bandForValue(min, element) != labels.BandIdeal) {
        return min-avg;
    }

    return 0;
}

// For a value and element type, return the band it fits
function bandForValue(value, element) {
    var band = bands[element];
    var currentBand = '';

    for (var level in band) {
        var minmax = band[level];
        var min = minmax[0];
        var max = minmax[1] || 1000; // use a really high max if one isn't specified

        // Check if each value lies in this band
        currentBand = min <= value && max >= value ? labels[level] : currentBand;
    }

    return currentBand;
}

// Calculates whether the values are within the ideal ranges
function whichBandsForData(array, maxIdx, minIdx, avg, element) {
    var minBand = bandForValue(array[minIdx], element);
    var maxBand = bandForValue(array[maxIdx], element);
    var avgBand = bandForValue(avg, element);

    return [maxBand, minBand, avgBand];
}

// Translate a band in to words
function nameForBand(band) {
    switch (band) {
        case labels.BandVeryHigh:
            return 'far too high';
        case labels.BandTooHigh:
            return 'too high';
        case labels.BandSlightlyHigh:
            return 'slightly too high';
        case labels.BandSlightlyLow:
            return 'slightly too low';
        case labels.BandTooLow:
            return 'too low';
        case labels.BandVeryLow:
            return 'far too low';
        default:
            return 'ideal';
    }
}

// Calculates averages/ranges and any spikes for a specific element
function processDataType(data, element, spikeMinimumLevel, timestamps, isPresent) {
    let [maxIdx, minIdx, avg, median, spikeLevel] = calculateRangesForData(data, spikeMinimumLevel, element);
    let [maxBand, minBand, avgBand] = whichBandsForData(data, maxIdx, minIdx, avg, element);

    // Create a spike comment (if there was one)
    // eg. At around 3am, the temperature got up to 73° which is too high to sleep.
    // eg. At 2.30am, the temperature went down to 58° which is too cold and may wake you up.
    var spike = null;
    if (spikeLevel != 0) {
        var theBand = spikeLevel > 0 ? maxBand : minBand;
        var theIdx = spikeLevel > 0 ? maxIdx : minIdx;

        var timezone = translateTimeZoneToLocation(this.attributes.timeZone);
        var time = moment(timestamps[theIdx]*1000).tz(timezone).format('ha');

        spike = Language.Summary.Spike('around '+time, element, data[theIdx] + units[element], nameForBand(theBand));
    }

    // Create a comment if values went far out of ideal bands
    // eg. The average temperature last night was 73° which is higher than most people like.
    // eg. The temperature got up to 71° which is higher than the recommended temperatures.
    var band = null;

    if (avgBand >= labels.BandTooHigh || avgBand <= labels.BandTooLow) {
        band = Language.Summary.Band("average", element, avg + units[element], avgBand >= labels.BandTooHigh ? "higher" : "lower", isPresent);
    } else if (maxBand >= labels.BandTooHigh) {
        band = Language.Summary.Band("maximum", element, data[maxIdx] + units[element], "higher", isPresent);
    } else if (minBand <= labels.BandTooLow) {
        band = Language.Summary.Band("minimum", element, data[minIdx] + units[element], "lower", isPresent);
    }

    // Make a general comment in case we have nothing else to talk about
    // eg. The temperature stayed on average around 64°.
    var general = Language.Summary.General(element, avg + units[element], nameForBand(avgBand), isPresent);

    /*
    console.log(element);
    console.log('general: '+general);
    console.log('band: '+band);
    console.log('spike: '+spike);
    */
    return [spike, band, general];
}

// Find the timestamp which is closes to the sleep/wake time
function findClosestTimestamp(timestamps, nearTime, fromEnd) {
    var add = fromEnd ? -1 : 1;
    var start = fromEnd ? timestamps.length-1 : 0;
    var timezone = translateTimeZoneToLocation(this.attributes.timeZone);

    // Convert nearTime (in format 14:30) to timestamp
    var hrs = parseInt(nearTime.slice(0, 2));
    var mins = parseInt(nearTime.slice(3, 5));

    var tz = moment().tz(timezone);

    // Subtract a day if it's for yesterday
    if (!fromEnd) {
        tz.subtract(1, 'days');
    }

    var nearTs = tz.startOf('day').add(hrs, 'hours').add(mins, 'minutes').format('X');
    var closestTs = timestamps.reduce((prev, curr) => Math.abs(curr - nearTs) < Math.abs(prev - nearTs) ? curr : prev);

    return timestamps.indexOf(closestTs) + 1;
}

function dataRangeForDate(data, date) {
    // For "last week": take the whole range
    var max = data.ts.length - 1;
    var min = 0;

    // For "now": consider last 2 readings
    if (date == 'today') {
        min = Math.max(0, max - 2);
    }
    // For "last night": take readings between user's sleep time and wake up time
    else if (date == 'yesterday') {
        min = findClosestTimestamp.call(this, data.ts, this.attributes.sleepTime, false);
        max = findClosestTimestamp.call(this, data.ts, this.attributes.wakeWeekdayTime, true);
    }

    return [date == 'today', min, max];
}

function produceDataSummary(data, date, element) {
    var [isPresent, minIdx, maxIdx] = dataRangeForDate.call(this, data, date);

    // Values for how much an element needs to go up or down over the average
    // to be considered a spike.
    var tempLimit = 5;
    var humidLimit = 5;
    var soundLimit = 20;
    var lightLimit = 10;

    var timestamps = data.ts.slice(minIdx, maxIdx);

    let tempSpike = null, tempBand = null, tempGeneral = null;
    let humidSpike = null, humidBand = null, humidGeneral = null;
    let soundSpike = null, soundBand = null, soundGeneral = null;
    let lightSpike = null, lightBand = null, lightGeneral = null;

    // Calculate spikes, non-ideal temperatures and general descriptions
    if (!element || element == 'temperature') {
        [tempSpike, tempBand, tempGeneral] = processDataType.call(this, data.t.slice(minIdx, maxIdx), elements.Temperature, tempLimit, timestamps, isPresent);
    }
    if (!element || element == 'humidity') {
        [humidSpike, humidBand, humidGeneral] = processDataType.call(this, data.h.slice(minIdx, maxIdx), elements.Humidity, humidLimit, timestamps, isPresent);
    }
    if (!element || element == 'sound') {
        [soundSpike, soundBand, soundGeneral] = processDataType.call(this, data.s.slice(minIdx, maxIdx), elements.Sound, soundLimit, timestamps, isPresent);
    }
    if (!element || element == 'light') {
        [lightSpike, lightBand, lightGeneral] = processDataType.call(this, data.l.slice(minIdx, maxIdx), elements.Light, lightLimit, timestamps, isPresent);
    }

    var summary = '';

    // Choose spikes in order: temp, humid, sound, light
    var chosenSpike = tempSpike ? tempSpike : 
                    humidSpike ? humidSpike : 
                    soundSpike ? soundSpike : 
                    lightSpike ? lightSpike : '';

    // If we're covering the whole week, don't point out a specific spike
    if (date != 'today' && date != 'yesterday') {
        chosenSpike = '';
    }

    summary += chosenSpike + ' ';

    // Then choose bands, same order but making sure they don't clash with the spike
    var chosenBand = (tempBand && chosenSpike != tempSpike) ? tempBand : 
                    (humidBand && chosenSpike != humidSpike) ? humidBand :
                    (soundBand && chosenSpike != soundSpike) ? soundBand :
                    (lightBand && chosenSpike != lightSpike) ? lightBand : '';
    summary += chosenBand + ' '; 

    // If there are no spikes or out of band periods, a general good message
    if (summary.trim() == '') {
        summary = Language.Summary.AllIsWell(isPresent) + ' ';
    }

    // Then add one of the general phrases not covered above
    var chosenGeneral = (chosenSpike != tempSpike && chosenBand != tempBand && tempGeneral) ? tempGeneral :
                        (chosenSpike != humidSpike && chosenBand != humidBand && humidGeneral) ? humidGeneral :
                        (chosenSpike != soundSpike && chosenBand != soundBand && soundGeneral) ? soundGeneral :
                        (chosenSpike != lightSpike && chosenBand != lightBand && lightGeneral) ? lightGeneral : '';
    summary += chosenGeneral;

    return summary;
}

function parseQueryInput(query) {
    // Parse the query string in to an object
    var vars = query.split("&");

    var query_string = {};
    for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split("=");

        // If first entry with this name
        if (typeof query_string[pair[0]] === "undefined") {
            query_string[pair[0]] = decodeURIComponent(pair[1]);
        // If second entry with this name
        } else if (typeof query_string[pair[0]] === "string") {
            var arr = query_string[pair[0]].concat(decodeURIComponent(pair[1]));
            query_string[pair[0]] = arr;
        // If third or later entry with this name
        } else {
            var arr = query_string[pair[0]].concat(decodeURIComponent(pair[1]));
            query_string[pair[0]] = arr;
        }
    }
    return query_string;
}

function resetState() {
    this.handler.state = '';
    delete this.attributes['STATE'];
}

function hasStoredGuid() {
    return this.attributes.guid;
}

function hasSleepTime() {
    return this.attributes.sleepTime;
}

function hasWakeWeekdayTime() {
    return this.attributes.wakeWeekdayTime;
}

function hasWakeWeekendTime() {
    return this.attributes.wakeWeekendTime;
}

function hasTimeZone() {
    return this.attributes.timeZone;
}

function hasAllPersonalInfo() {
    return hasSleepTime.call(this) && hasWakeWeekdayTime.call(this) && hasWakeWeekendTime.call(this) && hasTimeZone.call(this);
}

// Amazon-provided function for matching responses and synonyms to values
function getSlotValues(filledSlots) {
    //given event.request.intent.slots, a slots values object so you have
    //what synonym the person said - .synonym
    //what that resolved to - .resolved
    //and if it's a word that is in your slot values - .isValidated
    let slotValues = {};

    Object.keys(filledSlots).forEach(function(item) {
        var name = filledSlots[item].name;

        if(filledSlots[item]&&
           filledSlots[item].resolutions &&
           filledSlots[item].resolutions.resolutionsPerAuthority[0] &&
           filledSlots[item].resolutions.resolutionsPerAuthority[0].status &&
           filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code ) {

            switch (filledSlots[item].resolutions.resolutionsPerAuthority[0].status.code) {
                case "ER_SUCCESS_MATCH":
                    slotValues[name] = {
                        "synonym": filledSlots[item].value,
                        "resolved": filledSlots[item].resolutions.resolutionsPerAuthority[0].values[0].value.name,
                        "isValidated": filledSlots[item].value == filledSlots[item].resolutions.resolutionsPerAuthority[0].values[0].value.name
                    };
                    break;
                case "ER_SUCCESS_NO_MATCH":
                    slotValues[name] = {
                        "synonym":filledSlots[item].value,
                        "resolved":filledSlots[item].value,
                        "isValidated":false
                    };
                    break;
            }
        } else {
            slotValues[name] = {
                "synonym": filledSlots[item].value,
                "resolved":filledSlots[item].value,
                "isValidated": false
            };
        }
    }, this);

    //console.log("slot values: "+JSON.stringify(slotValues));
    return slotValues;
}

// Checks if this is an Echo device with a screen
function supportsDisplay() {
    var hasDisplay =
        this.event.context &&
        this.event.context.System &&
        this.event.context.System.device &&
        this.event.context.System.device.supportedInterfaces &&
        this.event.context.System.device.supportedInterfaces.Display

    return hasDisplay;
}

// Is this the Echo simulator?
function isSimulator() {
    var isSimulator = !this.event.context; // simulator doesn't send context
    return isSimulator;
}

// Remove blank array entries
Array.prototype.clean = function(deleteValue) {
  for (var i = 0; i < this.length; i++) {
    if (this[i] == deleteValue) {         
      this.splice(i, 1);
      i--;
    }
  }
  return this;
};

