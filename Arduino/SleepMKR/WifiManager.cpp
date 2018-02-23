#include "WifiManager.h"
#include <WiFiSSLClient.h>
#include <SdFat.h>
#include "TrueRandom.h"

extern SdFat SD;

const char *ssid = "SleepMonitor";
WifiManager *instance;

void serverSelectPage(WebServer &, WebServer::ConnectionType, char *, bool);
void serverConnectPage(WebServer &, WebServer::ConnectionType, char *, bool);

WifiManager::WifiManager() {
  // Set up the web server, for wifi network setup
  server = new WebServer("", 80);
  server->setDefaultCommand(serverSelectPage);
  server->addCommand("connect", serverConnectPage);
  
  instance = this;
}

void WifiManager::connect() {
	bool haveCredentials = false;	

  Serial.println("Wifi Connecting");

  if (!openSettingsFile()) {		
    // First time so we don't have settings and need to generate a GUID and PIN
    Serial.println("No Settings");
    generateGuidAndPin();
  } else {
    Serial.println("Have credentials");

    // We have credentials if the SSID/password are set
    haveCredentials = settings.ssid[0] != 0 && settings.password[0] != 0;
  }

  // Attempt to connect to stored network
  if (haveCredentials)  {
    Serial.println("Trying to connect to wifi");
    Serial.print("s: ");
    Serial.println(settings.ssid);
    Serial.print("p: ");
    Serial.println(settings.password);
    
    // Connect to network
    WiFi.hostname(ssid);
    int st = WiFi.begin(settings.ssid, settings.password);

    // If we connected, great, we are done.
    if (st == WL_CONNECTED) {
      Serial.print("Connected with credentials: ");
      IPAddress ip = WiFi.localIP();
      Serial.println(ip);
      
      // Send the GUID to the link server, so that it has the latest device IP address
      sendGuidAndPin();
      status = WifiConnected;
      return;
    }

    // If we couldn't connect, reset the ssid/password and open the access point
    Serial.println("Failed to connect");
    memset(&settings.ssid, 0, sizeof(settings.ssid));
    memset(&settings.password, 0, sizeof(settings.password));	
  }

  Serial.println("Starting access point");

  // Set up the IP/DNS for the device
  const byte dnsPort = 53;
  IPAddress apIP(192, 168, 1, 1);
  WiFi.config(apIP, apIP);

  // List any WiFi networks we can see
  listNetworks();
  Serial.println("Listed networks");
  
  // Then begin the access point, so users can join
  if (WiFi.beginAP(ssid) != WL_AP_LISTENING) {
    Serial.println("Creating access point failed");
    status = WifiError;
    return;
  }

  // Start up the DNS server
  dnsServer.start(dnsPort, "*", apIP);  
  Serial.println("DNS started");

  // Start the web server
  server->begin();
  Serial.println("Server begin");

  IPAddress ip = WiFi.localIP();
  Serial.println(ip);

  // Jump in to a loop of waiting for credentials, then trying to connect with them
  while (true) {
    serverLoop();

    // Close the AP
    WiFi.end();

    // Try to connect
    Serial.println("Trying to connect");
    Serial.println(settings.ssid);
    Serial.println(settings.password);
    int st = WiFi.begin(settings.ssid, settings.password);

    if (st != WL_CONNECTED) {
      memset(&settings.ssid, 0, sizeof(settings.ssid));
      memset(&settings.password, 0, sizeof(settings.password));
      Serial.println("Failed to connect to new network");

      // Restart AP
      WiFi.beginAP(ssid);
    } else {
      break;
    }
  }

  Serial.print("Connected! ");
  ip = WiFi.localIP();
  Serial.println(ip);

    // We are done: save settings and send GUID/PIN to link server  
  saveSettings(settings);
  sendGuidAndPin();

  status = WifiConnected;
}

// Scan for available networks
void WifiManager::listNetworks() {
	numberOfVisibleNetworks = WiFi.scanNetworks();

  Serial.print("Number of networks: ");
  Serial.println(numberOfVisibleNetworks);
  if (numberOfVisibleNetworks == -1) {
    Serial.println("Error listing networks");
    numberOfVisibleNetworks = 0;
  }
}

void WifiManager::serverLoop() {
  // Until we get credentials, process web server connections
  while (settings.ssid[0] == 0) {
    dnsServer.processNextRequest();
    server->processConnection();
    yield();
  }
}

// Store the HTML in program memory
P(htmlHead) = "<html>"
"<head>"
"<title>Good Sleep - WiFi Setup</title>"
"<meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1,user-scalable=0'>"
"</head>"
"<body>"
"<div align='center' style='font-family: Helvetica Neue;'>"
"<h2 style='margin: 0; color: #22bbb5'>Good Sleep</h2>"
"<h3 style='margin-top: 0; color: #666'>WiFi Setup</h3>";

// Request for listing wifi networks and entering credentials
void serverSelectPage(WebServer &server, WebServer::ConnectionType type, char *urlTail, bool tailComplete) {
  Serial.println("Wifi select page");

  char *pin = new char[5];
  memset(pin, 0, 5);
  memcpy(pin, instance->settings.pin, PIN_LENGTH);

  server.httpSuccess();

  P(htmlPostPin) = "</b><br />Write this down, Alexa will ask for it!</p>"
  "<hr />"
  "<form method='POST' action='connect'>"
  "<table width='200px'>"
  "<tr><td>Network</td><td><select name='ssid'>";

  P(htmlPostSsid) = "</select></td></tr>"
  "<tr><td>Password</td><td><input type='password' name='pw' value='eveyisasweetkitty' /></td></tr>"
  "<tr><td colspan='2' align='center'><br /><input type='submit' value='Connect' /></td></tr>"
  "</table>"
  "</form>"
  "</div>"
  "</body>"
  "</html>";

  server.printP(htmlHead);
  server.print("<p>Your PIN is <b>");
  server.print(pin);
  server.printP(htmlPostPin);

  // Add the visible networks to a dropdown list in the html
  for (int i=0; i<instance->numberOfVisibleNetworks; i++) {
    server.print("<option value='" + String(WiFi.SSID(i)) + "'>" + String(WiFi.SSID(i)) + "</option>");
  }

  server.printP(htmlPostSsid);

  delete pin;
}

// Request to receive entered credentials
void serverConnectPage(WebServer &server, WebServer::ConnectionType type, char *urlTail, bool tailComplete) {
  Serial.println("Wifi connect page");

  server.httpSuccess();
  server.printP(htmlHead);
  server.print("<hr /><p><b>Connecting...</b></p><p>Wait a minute and then ask Alexa:<br />\"Open Good Sleep\".</p></div></body></html>");

  const int maxLength = 64;
  char name[maxLength];
  char value[maxLength];

  // Read from the POSTed form variables, copy them in to our settings
  while (server.readPOSTparam(name, maxLength, value, maxLength)) {
    if (strcmp(name, "ssid") == 0) {
      memcpy(&instance->settings.ssid, value, 32);
    }
    else if (strcmp(name, "pw") == 0) {
      if (strlen(value) > 0) {
        memcpy(&instance->settings.password, value, 64);
      } else {
        memset(&instance->settings.password, 0, 64);
      }
    }
  }

  server.flushBuf();
}

// Generate a GUID and PIN number
void WifiManager::generateGuidAndPin() {
  byte uuid[16];
  TrueRandom.uuid(uuid);

  char *hex = "0123456789ABCDEF";

  Serial.print("guid: ");

  // A GUID is 32 bytes long
  for (int i=0; i<16; i++) {
    int topDigit = uuid[i] >> 4;
    int bottomDigit = uuid[i] & 0x0f;

    settings.guid[i*2] = hex[topDigit];
    settings.guid[i*2+1] = hex[bottomDigit];

    Serial.print(hex[topDigit]);
    Serial.print(hex[bottomDigit]);
  }

  Serial.print(" pin: ");

  for (uint8_t i=0; i<PIN_LENGTH; i++) {
    int rand = (int)TrueRandom.random(9);
    itoa(rand, &settings.pin[i], 10);

    Serial.print(settings.pin[i]);
  }

  Serial.println(" ");
}

// Connect to our link server to update the GUID and PIN
void WifiManager::sendGuidAndPin() {
  const char* host = "y0pths7tg4.execute-api.us-east-1.amazonaws.com";
  const int httpsPort = 443;

  // Use the SSL client to connect to our secure API Gateway service
  WiFiSSLClient client;
  
  if (!client.connect(host, httpsPort)) {
    Serial.println("GUID connection failed");
    return;
  }

  // Send the GUID/PIN in the URL
  String url = "/prod/guid?guid="+String(settings.guid)+"&pin="+String(settings.pin)+"&port=36099";
  Serial.print("Requesting URL: ");
  Serial.println(url);

  client.print(String("GET ") + url + " HTTP/1.1\r\n" +
   "Host: " + host + "\r\n" +
   "User-Agent: SleepMonitor\r\n" +
   "Connection: close\r\n\r\n");

  // Read from the client until we have all the headers, then bail
  while (client.connected()) {
    String line = client.readStringUntil('\n');

    if (line == "\r") {
      Serial.println("GUID headers received");
      break;
    }
  }
}

// Open the settings file if it exists
bool WifiManager::openSettingsFile() {
  if (SD.exists("settings.txt")) {
    File settingsFile = SD.open("settings.txt", FILE_READ);

    int fileSize = settingsFile.size();

    // Read the struct in from the file
    WifiSettings loadSettings;
    settingsFile.seek(0);
    settingsFile.read((byte *)&loadSettings, sizeof(WifiSettings));
    settings = loadSettings;

    settingsFile.close();
    
    return true;
  }

  return false;
}

// Save out new settings
void WifiManager::saveSettings(WifiSettings newSettings) {
  settings = newSettings;

  // Write the settings struct to the file
  File settingsFile = SD.open("settings.txt", (O_WRITE | O_CREAT));
  settingsFile.seek(0);
  settingsFile.write((byte *)&settings, sizeof(WifiSettings));
  settingsFile.close();
}
