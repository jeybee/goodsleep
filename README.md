# Good Sleep - Your Nighttime Monitor
Good Sleep is an Arduino-powered sleep monitoring device paired with an Alexa skill to read and interpret the readings as well as a service that produces charts to visually display trends.

The skill is available on the [Amazon Skills store here](https://smile.amazon.com/dp/B079TJYXJ5/ref=sr_1_1?s=digital-skills&ie=UTF8&qid=1520617020&sr=1-1).

To see the full details about this project and read more, see the [project page on Hackster](https://www.hackster.io/jey-biddulph/good-sleep-your-nighttime-monitor-740995). This is an entry in to the Alexa and Arduino Smart Home Challenge competition.

This repository contains all the code parts, fully commented, that come together to make this work:

* Arduino software for deploying on the MKR1000
* Lambda code for Alexa skill
* Lambda code for linking and chart API Gateway services

This project uses a number of different AWS services, and setup instructions for each are included:

* [Lambda for Alexa skill and Chart/Link services](http://github.com/jeybee/goodsleep/blob/master/Setup_Lambda.md)
* [API Gateway](http://github.com/jeybee/goodsleep/blob/master/Setup_APIGateway.md)
* [Alexa Skill Configuration](http://github.com/jeybee/goodsleep/blob/master/Setup_Alexa.md)

### Third Party Libraries

Thanks to these third party libraries that were used in the Arduino and Lambda code.

#### Arduino
* TrueRandom
* DHT11
* DNSServer
* SdFat
* EDB
* Webduino
* Portmapping

#### Lambda
* lz-string
* moment-timezone
* chartjs-node
* node-canvas
