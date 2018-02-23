#ifndef SensorManager_h
#define SensorManager_h

#include <SPI.h>
#include <RTCZero.h>
#include "dht11.h"

// Structure of a reading, as stored in the DB
// The numbers are stored as chars and massaged to 0-255
struct SensorEvent {
  uint32_t timestamp;
  char temperature;
  char humidity;
  char soundLevel;
  char lightLevel;
};

class SensorManager
{
  public:
    SensorManager(RTCZero rt);
    SensorEvent read();
    void update();

  private:
    void updateLightLevels();
    void readSoundLevels();
    void updateSoundLevels();
    void updateTempHumidity();
    double convertToFahrenheit(int celsius);

    RTCZero rtc;
    SensorEvent currentEvent = {};
        
    const int pinDht = 3;
    const int pinMic = A1;
    const int pinPhotoCell = A4;

    // Temperature / Humidity
    dht11 DHT11;

    // Microphone
    const long micUpdateMilliseconds = 100;
    unsigned int maxAmp = 0;
    unsigned int minAmp = 1023;
    unsigned long lastMicUpdateTime = 0;

    // Photocell
    const float R_DIV = 4660.0;
    const float VCC = 4.98;
};

#endif
