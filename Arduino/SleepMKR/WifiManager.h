#ifndef WifiManager_h
#define WifiManager_h

#include <SPI.h>
#include "DNSServer.h"
#include <WiFi101.h>
#include <WebServer.h>

enum WifiManagerStatus {
  WifiUnknown,
  WifiDisconnected,
  WifiConnected,
  WifiError,
};

// Wifi Settings that are stored on the SD card
const uint8_t PIN_LENGTH = 4;
struct WifiSettings {
  char ssid[32];
  char password[64];
  char guid[32];
  char pin[PIN_LENGTH];
};

class WifiManager
{
  public:
    WifiManager();
    void connect();

    WifiManagerStatus status = WifiUnknown;
    WifiSettings settings = {};
    int numberOfVisibleNetworks = 0;
    
  private:
    void sendGuidAndPin();
    void generateGuidAndPin();
    bool openSettingsFile();
    void saveSettings(WifiSettings newSettings);
    void listNetworks();
    void serverLoop();

    WebServer *server;
    DNSServer dnsServer;
};

#endif
