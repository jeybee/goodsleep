#ifndef DatabaseManager_h
#define DatabaseManager_h

#include <Arduino.h>
#include <EDB.h>
#include "SensorManager.h"

class File;
class WebServer;

class DatabaseManager
{
  public:
    DatabaseManager(int maxRecordCount);
    void init();
    void writeDataLogLine(struct SensorEvent event);
    void fetchAndPrintData(WebServer& client, unsigned long minTimestamp, unsigned long maxTimestamp, int skip);

    File dbFile;
    
  private:
    void printDBError(EDB_Status err);

    const char *dbPath = "logging.db";
    int maxRecordCount;
    EDB *edb;
};

#endif
