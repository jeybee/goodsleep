#include "SensorManager.h"

SensorManager::SensorManager(RTCZero rt):rtc(rt) {
}

// Return a SensorEvent containing latest reading
SensorEvent SensorManager::read() {
  // Get the current time from the realtime clock
	currentEvent.timestamp = rtc.getEpoch();

  // Update sensor values
	updateTempHumidity();
	updateSoundLevels();
	updateLightLevels();

	// Reset mic levels
  maxAmp = 0;
  minAmp = 1023;

	return currentEvent;
}

void SensorManager::update() {
  // Every so often, check the mic for sounds in between readings
	if ((millis() - lastMicUpdateTime) > micUpdateMilliseconds) {
    readSoundLevels();
    lastMicUpdateTime = millis();
	}
}

void SensorManager::updateTempHumidity() {
  // Read temperature and humidity from the DHT11 chip
  int chk = DHT11.read(pinDht);

  // Exclude errors in the humidity value
  if (DHT11.humidity < 100) {
    currentEvent.humidity = (char)DHT11.humidity;
  }
  
  // Convert from celsius
  currentEvent.temperature = (char)convertToFahrenheit(DHT11.temperature);
}

void SensorManager::updateSoundLevels() {
  // Update the sound level to the amplitude we've received (maximum 120dB)
  currentEvent.soundLevel = map(maxAmp-minAmp, 0, 1023, 0, 120);
}

void SensorManager::readSoundLevels() {
  // Read from the microphone
  int micOut = analogRead(pinMic);

  // Prevent erroneous out of range readings
  if (micOut < 1023 && micOut >= 0) {
    // Store the max and min for the time period
    if (micOut > maxAmp) {
      maxAmp = micOut;
    }
    else if (micOut < minAmp) {
      minAmp = micOut;
    }
  }
}

void SensorManager::updateLightLevels() {
  // Read light level from the photocell
  int photoOut = analogRead(pinPhotoCell);

  if (photoOut > 0) {
    // Use the ADC reading to calculate voltage and resistance
    float lightV = photoOut * VCC / 1023.0;
    float lightR = R_DIV * (VCC / lightV - 1.0);
    
    currentEvent.lightLevel = (int)(lightV / 5.0 * 255.0);
  }
}

double SensorManager::convertToFahrenheit(int celsius) {
  return 1.8 * (double)celsius + 32;
}

