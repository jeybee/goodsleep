#include <Arduino.h>

// Timing
#include <RTCZero.h>
void initTime();

RTCZero rtc;
unsigned long lastSensorUpdateTime = 0;
const int sensorUpdatePeriod = 300;//20;
const long sensorUpdateMS = sensorUpdatePeriod * 1000.0;
const int updatesPerHour = (60 * 60) / sensorUpdatePeriod;

// SD Card
#include <SPI.h>
#include <SdFat.h>
SdFat SD;
bool initSD();

const int pinSD = 6;

// Database
#include "DatabaseManager.h"
DatabaseManager dbManager(updatesPerHour * 24 * 7);

// Sensors
#include "SensorManager.h"
SensorManager sensorManager(rtc);

// Wireless
#include "WifiManager.h"
WifiManager manager;

// NTP
WiFiUDP udp;
IPAddress ntpServerIP;
const char* ntpServerName = "time.nist.gov";
const unsigned int ntpLocalPort = 2390;
const int ntpPacketSize = 48;
byte ntpPacketBuffer[ ntpPacketSize];

unsigned long fetchTime();

// Web Server
#include <portMapping.h>
#include <WebServer.h>

const unsigned int serverPort = 36099;
PortMapClass portmap;
WebServer webServer("", serverPort);
int webTailLength = 128;
char webTailBuff[128];

void webServerFetchPage(WebServer&, WebServer::ConnectionType, char *, bool);

void setup() {
  Serial.begin(9600);
  delay(1000);
  
  Serial.println("Starting setup");
  
  // Init SD card
  initSD();

  // Hand over to the WifiManager to connect to wireless
  manager.connect();

  // Setup the db, update the time, then start the web server
  dbManager.init();
  initTime();
  initServer();

  Serial.println("Connected and server running");
}

// Start the web server
void initServer() {
  // Set up /fetch callback
  webServer.addCommand("fetch", &webServerFetchPage);
  webServer.begin();

  // Add UPnP mapping to enable outside access
  if (!portmap.addPortMap(WiFi.localIP(), serverPort, serverPort)) {
    Serial.println("Error setting up UPnP");
  }
}

// Fetch time with NTP
void initTime() {
  unsigned long epoch = fetchTime();

  if (epoch <= 0) {
    Serial.println("Failed to get time");
  } else {
    // Set internal real time clock
    rtc.begin();
    rtc.setEpoch(epoch);
  }

  Serial.print("Initialised time: ");
  Serial.println(epoch);
}

// Initialise SD Card
bool initSD() {
  if (!SD.begin(pinSD)) {
    Serial.println("SD initialization failed!");
    return false;
  }
  
  Serial.println("SD initialized");
  return true;
}

void loop() {
  // Process any incoming web connections
  webServer.processConnection(webTailBuff, &webTailLength);
  
  // Update the sensors
  sensorManager.update();

  // Write a reading to the database every 5 minutes
  if ((millis() - lastSensorUpdateTime) > sensorUpdateMS) {
    SensorEvent event = sensorManager.read();

    if (!rtc.isConfigured()) {
      Serial.println("Time is not configured.");
    } else {
      dbManager.writeDataLogLine(event);
    }
    
    lastSensorUpdateTime = millis();
  }
}

// Called when /fetch is called on the web server
void webServerFetchPage(WebServer &server, WebServer::ConnectionType type, char *urlTail, bool tailComplete) {
  const int maxLength = 8;
  char name[maxLength];
  char value[maxLength];

  unsigned long maximumTime = 0;
  unsigned long minimumTime = 0;
  int perHour = 0;

  // Parse the query string parameters to get min and max timestamps and the number of readings per hour
  while (server.nextURLparam(&urlTail, name, maxLength, value, maxLength) != URLPARAM_EOS) {
    if (strcmp(name, "max") == 0) {
      maximumTime = strtoul(value, NULL, 10);
    }
    else if (strcmp(name, "min") == 0) {
      minimumTime = strtoul(value, NULL, 10);
    }
    else if (strcmp(name, "ph") == 0) {
      perHour = (int)strtol(value, NULL, 10);
    }
  }
  
  if (maximumTime == 0 && minimumTime == 0 && perHour == 0) {
    // If arguments are missing, throw an error
    server.httpServerError();
  }
  else {
    server.httpSuccess();
    
    // Fetch the data from the DB skipping over some to get the right granularity
    int skip = updatesPerHour / perHour;
    dbManager.fetchAndPrintData(server, minimumTime, maximumTime, skip);
  }
}

// Send the packet to the time update server
void sendNTPpacket() {
  // Set all bytes in the buffer to 0
  memset(ntpPacketBuffer, 0, ntpPacketSize);
  
  // Initialize values needed to form NTP request
  ntpPacketBuffer[0] = 0b11100011;   // LI, Version, Mode
  ntpPacketBuffer[1] = 0;     // Stratum, or type of clock
  ntpPacketBuffer[2] = 6;     // Polling Interval
  ntpPacketBuffer[3] = 0xEC;  // Peer Clock Precision
  
  // 8 bytes of zero for Root Delay & Root Dispersion
  ntpPacketBuffer[12]  = 49;
  ntpPacketBuffer[13]  = 0x4E;
  ntpPacketBuffer[14]  = 49;
  ntpPacketBuffer[15]  = 52;

  // all NTP fields have been given values, now
  // you can send a packet requesting a timestamp:
  udp.beginPacket(ntpServerIP, 123); //NTP requests are to port 123
  udp.write(ntpPacketBuffer, ntpPacketSize);
  udp.endPacket();
}

// Fetch current time from NTP server
unsigned long fetchTime() {
  udp.begin(ntpLocalPort);
  WiFi.hostByName(ntpServerName, ntpServerIP); 
  sendNTPpacket(); // send an NTP packet to a time server

  while(true) {
    int cb = udp.parsePacket();
    if (cb) {
      // We've received a packet, read the data from it
      udp.read(ntpPacketBuffer, ntpPacketSize); // read the packet into the buffer
  
      //the timestamp starts at byte 40 of the received packet and is four bytes,
      // or two words, long. First, extract the two words:
      unsigned long highWord = word(ntpPacketBuffer[40], ntpPacketBuffer[41]);
      unsigned long lowWord = word(ntpPacketBuffer[42], ntpPacketBuffer[43]);

      // combine the four bytes (two words) into a long integer
      // this is NTP time (seconds since Jan 1 1900):
      unsigned long secsSince1900 = highWord << 16 | lowWord;
  
      // now convert NTP time into everyday time:
      // Unix time starts on Jan 1 1970. In seconds, that's 2208988800:
      const unsigned long seventyYears = 2208988800UL;
      unsigned long epoch = secsSince1900 - seventyYears;

      return epoch;
    }

    yield;
  }
}
