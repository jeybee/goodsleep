#include <WebServer.h>
#include <SdFat.h>
#include "DatabaseManager.h"

extern SdFat SD;

void edbWriter(unsigned long address, const byte* data, unsigned int recsize);
void edbReader(unsigned long address, byte* data, unsigned int recsize);
DatabaseManager *dbInstance;

DatabaseManager::DatabaseManager(int max):maxRecordCount(max) {
  dbInstance = this;
}

void DatabaseManager::init() {
  Serial.print("DBManager initialising...");
  
  // Setup the database
  edb = new EDB(&edbWriter, &edbReader);

  // set table size to 7 days worth of events
  unsigned long tableSize = sizeof(struct SensorEvent) * maxRecordCount;
  
  if (SD.exists(dbPath)) {
    dbFile = SD.open(dbPath, (O_READ | O_WRITE | O_CREAT));

    // Sometimes it wont open at first attempt, especially after cold start
    // Let's try one more time
    if (!dbFile) {
      dbFile = SD.open(dbPath, (O_READ | O_WRITE | O_CREAT));
    }

    if (dbFile) {
      Serial.print("Opening current table... ");
          
      // Try to open database
      EDB_Status result = edb->open(0);
      
      if (result != EDB_OK) {
        // Create new table if can't
        Serial.println("ERROR");
        Serial.println("Did not find database in the file " + String(dbPath));
        Serial.print("Creating new table... ");
        edb->create(0, tableSize, (unsigned int)sizeof(struct SensorEvent));
      }
    } else {
      Serial.println("Could not open file " + String(dbPath));
      return;
    }
  } else {
    Serial.print("Creating table... ");
      
    // Set up a new database
    dbFile = SD.open(dbPath, (O_READ | O_WRITE | O_CREAT));
    edb->create(0, tableSize, (unsigned int)sizeof(struct SensorEvent));
  }

  Serial.println("DB initialized");
}

// Retrieve readings between timestamps and print them out to the web client
void DatabaseManager::fetchAndPrintData(WebServer& client, unsigned long minTimestamp, unsigned long maxTimestamp, int skip) {  
  SensorEvent readEvent;
  String temp = "";
  String humid = "";
  String sound = "";
  String light = "";
  String ts = "";

  Serial.println("Retrieving data: "+String(minTimestamp)+" to "+String(maxTimestamp)+" skip: "+String(skip));

  bool started = false;
  int i=0;

  // Loop through the readings, latest first, skipping the specified number
  for (int rec = edb->count(); rec > 0; rec-=skip) {
    EDB_Status result = edb->readRec(rec, EDB_REC readEvent);

    if (result != EDB_OK) {
      Serial.println("ERROR Retrieving Record");
    }
    // Check if the reading is between the requested timestamps
    else if (readEvent.timestamp >= minTimestamp && readEvent.timestamp <= maxTimestamp) {
      started = true;
      
      // Add the reading to the lists we're keeping
      temp += (int)readEvent.temperature;
      temp += ",";
      humid += (int)readEvent.humidity;
      humid += ",";
      sound += (int)readEvent.soundLevel;
      sound += ",";
      light += (int)readEvent.lightLevel;
      light += ",";
      ts += (uint32_t)readEvent.timestamp;
      ts += ",";
    
      i++;
  
      // Every 50 results, print out to the web client so we aren't storing
      // strings in memory that are too long
      if (i >= 50) {
        client.print("&t=");
        client.print(temp);
        client.print("&h=");
        client.print(humid);
        client.print("&s=");
        client.print(sound);
        client.print("&l=");
        client.print(light);
        client.print("&ts=");
        client.print(ts);
  
        temp = "";
        humid = "";
        sound = "";
        light = "";
        ts = "";
  
        i = 0;
      }
    } else if (started) {
      // Stop adding records not within the timestamps
      break;
    }
  }
  
  // Print out the remaining readings
  client.print("&t=");
  client.print(temp);
  client.print("&h=");
  client.print(humid);
  client.print("&s=");
  client.print(sound);
  client.print("&l=");
  client.print(light);
  client.print("&ts=");
  client.print(ts);
}

// Write a reading to the database
void DatabaseManager::writeDataLogLine(struct SensorEvent event) {
  EDB_Status result = edb->appendRec(EDB_REC event);
  
  // For debugging
  Serial.print(event.timestamp); Serial.print(", ");
  Serial.print((int)event.temperature); Serial.print(", ");
  Serial.print((int)event.humidity); Serial.print(", ");
  Serial.print((int)event.soundLevel); Serial.print(", ");
  Serial.println((int)event.lightLevel);
  
  if (result != EDB_OK) {
    printDBError(result);
  }
}

// Print DB error if one happens
void DatabaseManager::printDBError(EDB_Status err) {
  switch (err) {
    case EDB_OUT_OF_RANGE:
      Serial.println("Recno out of range");
      break;
    case EDB_TABLE_FULL:
      Serial.println("Table full");
      break;
    case EDB_OK:
    default:
      Serial.println("OK");
      break;
  }
}

// Database Read and Write functions
inline void edbWriter (unsigned long address, const byte* data, unsigned int recsize) {
  dbInstance->dbFile.seek(address);
  dbInstance->dbFile.write(data,recsize);
  dbInstance->dbFile.flush();
}

inline void edbReader (unsigned long address, byte* data, unsigned int recsize) {
  dbInstance->dbFile.seek(address);
  dbInstance->dbFile.read(data,recsize);
}

