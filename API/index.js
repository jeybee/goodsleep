'use strict';

const AWS = require('aws-sdk');
const ChartjsNode = require('chartjs-node');
const LZString = require('lz-string');

// This fixes a Chart.js bug!
if (global.CanvasGradient === undefined) {
  global.CanvasGradient = function() {};
}

const dynamoDbTable = 'SleepMonitor';
const dynamoDbLinkTable = 'sleepMonitorLink';
const AWSregion = 'us-east-1';
AWS.config.update({region: AWSregion});

var docClient = new AWS.DynamoDB.DocumentClient();

// Handler for incoming URLs
exports.handler = function(event, context, callback) {
    //console.log(JSON.stringify(event));
    var path = event.path;

    // Request for updating the IP address and PIN related to a GUID
    if (path == "/guid") {
        updateGuid(event.queryStringParameters.guid, 
                event.queryStringParameters.pin, 
                event.requestContext.identity.sourceIp, 
                event.queryStringParameters.port, 
                callback);

        return;
    }
    // Request for a chart image
    else if (path == "/chart") {
        // All the chart data is in the query string
        var data = LZString.decompressFromEncodedURIComponent(event.queryStringParameters.d);

        drawChart(data, (buffer, err) => {
            if (err) {
                callback(null, {statusCode: 500});
                return;
            }

            // Set up the image response
            let resp = {
                statusCode: 200,
                headers: {
                    'Content-Type': 'image/png'
                },
                body: buffer,
                isBase64Encoded: true
            };

            callback(null, resp);
        });

        return;
    }

    callback(null, {"Bail":event.path});
};

// Update GUID, PIN and IP
function updateGuid(guid, pin, ip, port, callback) {
    // Params for updating the DynamoDB table with the GUID and associated info
    var params = {
        TableName: "sleepMonitorLink",
        Item: {
            "guid": guid,
            "pin": parseInt(pin),
            "ip": ip,
            "port": parseInt(port)
        },
    };

    docClient.put(params, (err, data) => {
        // Bail out if there's an error
        if (err) {
            console.error("Unable to put item. Error JSON:", JSON.stringify(err, null, 2));
            callback(err, {
                statusCode: 500,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: '{"success": 0"}',
            });
            return;
        }

        // Send a success response
        let resp = {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: '{"success": 1}'
        };

        callback(null, resp);
    });
}

// Parse a query string in to an object
function parseQueryInput(query) {
    var vars = query.split("&");

    var query_string = {};
    for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split("=");

        // If first entry with this name
        if (typeof query_string[pair[0]] === "undefined") {
            query_string[pair[0]] = decodeURIComponent(pair[1]);
        // If second entry with this name
        } else if (typeof query_string[pair[0]] === "string") {
            var arr = [query_string[pair[0]], decodeURIComponent(pair[1])];
            query_string[pair[0]] = arr;
        // If third or later entry with this name
        } else {
            query_string[pair[0]].push(decodeURIComponent(pair[1]));
        }
    }

    return query_string;
}

// Draw a chart with Chart.js
function drawChart(data, callback) {
    var params = parseQueryInput(data);

    console.log(JSON.stringify(params));

    // Colors for chart lines and backgrounds
    var chartColors = {
        red: 'rgb(255, 99, 132)',
        orange: 'rgb(255, 159, 64)',
        yellow: 'rgb(255, 205, 86)',
        green: 'rgb(75, 192, 192)',
        blue: 'rgb(54, 162, 235)',
        grey: 'rgb(201, 203, 207)'
    };

    var bgColors = {
        red: 'rgba(255, 99, 132, 0.1)',
        orange: 'rgba(255, 159, 64, 0.1)',
        yellow: 'rgba(255, 205, 86, 0.1)',
        green: 'rgba(75, 192, 192, 0.1)',
        blue: 'rgba(54, 162, 235, 0.1)',
        grey: 'rgba(201, 203, 207, 0.5)'
    };

    // Data
    var temperatures = null, humidity = null, light = null, sound = null;
    var datasets = [];

    // Set up each dataset with different colors
    if (params.t) {
        temperatures = params.t.split(',');
        datasets.push({
            label: 'Temperature',
            data: temperatures,
            borderColor: chartColors.blue,
            backgroundColor: bgColors.blue,
            fill: false,
        });
    }
    if (params.h) {
        humidity = params.h.split(',');
        datasets.push({
            label: 'Humidity',
            data: humidity,
            borderColor: chartColors.red,
            backgroundColor: bgColors.red,
            fill: false,
        });
    }
    if (params.l) {
        light = params.l.split(',');
        datasets.push({
            label: 'Light',
            data: light,
            borderColor: chartColors.yellow,
            backgroundColor: chartColors.yellow,
            yAxisID: "y-axis-light",
            fill: true,
        }); 
    }
    if (params.s) {
        sound = params.s.split(',');
        datasets.push({
            label: 'Sound',
            data: sound,
            borderColor: bgColors.grey,
            backgroundColor: bgColors.grey,
            yAxisID: "y-axis-sound",
            fill: true,
            borderWidth: 0.1,
        });
    }

    // Timestamp labels
    var xAxisLabels = [];
    var labels = params.x.split(',');
    labels.forEach(label => {
        let [idx, val] = label.split('=');
        xAxisLabels[idx] = val;
    });

    // Data set to match chart labels to
    var data = temperatures ? temperatures : humidity ? humidity : light ? light : sound;
    var chartLabels = [];

    for (var i=0; i<data.length; i++) {
        chartLabels[i] = xAxisLabels[i] || '';
    }

    // Chart configuration
    var config = {
        width: 720,
        height: 480,
        chart: {
            type: 'line',
            data: {
                labels: chartLabels,
                fill: false,
                datasets: datasets
            },
            options: {
                legend: {
                    labels: {
                        boxWidth: 20,
                        fontFamily: "'Verdana'",
                        fontColor: '#888',
                        fontWeight: 'bold',
                    },
                },
                // Hide individual points
                elements: {
                    point: {
                        radius: 0
                    }
                },
                // Set up X and Y axes
                scales: {
                    xAxes: [
                        {
                            ticks: {
                                callback: function(dataLabel, index) {
                                    // Hide blank labels
                                    if (dataLabel == '') {
                                        return null;
                                    }

                                    return dataLabel;
                                },
                                maxRotation: 0,
                                padding: 6, 
                                autoSkip: false,
                                fontFamily: "'Verdana'",
                                fontColor: '#888',
                            },
                            gridLines: {
                                drawTicks: true,
                            },
                        },
                    ],
                    yAxes: [
                        {
                            type: "linear",
                            position: "left",
                            ticks: {
                                suggestedMax: 80,
                                suggestedMin: 30,
                                stepSize: 10,
                                fontFamily: "'Verdana'",
                                fontColor: '#888',
                                padding: 6, 
                            },
                            gridLines: {
                                drawOnChartArea: false, // only want the grid lines for one axis to show up
                                drawTicks: false, 
                            },
                        },
                        {
                            type: "linear",
                            display: false,
                            id: "y-axis-light",
                            ticks: {
                                beginAtZero: true,
                                max: 250,
                            },
                            gridLines: {
                                drawOnChartArea: false, // only want the grid lines for one axis to show up
                            },
                        },
                        {
                            type: "linear",
                            display: false,
                            id: "y-axis-sound",
                            ticks: {
                                beginAtZero: true,
                                max: 250,
                            },
                            gridLines: {
                                drawOnChartArea: false, // only want the grid lines for one axis to show up
                            },
                        }, 
                    ],
                },
                responsive: false,
                animation: false,
                responsiveAnimationDuration: 0,
            },
        }
    };

    // Create a new Chart.js node of the right size
    var chartNode = new ChartjsNode(config.width, config.height);

    // Parameters to set before drawing takes place
    chartNode.on('beforeDraw', function (Chartjs) {
        Chartjs.defaults.global.defaultFontFamily = "'Verdana'";
        Chartjs.defaults.global.defaultFontSize = 15;
        Chartjs.defaults.global.defaultFontColor = "#888#";
    });

    // Draw the chart
    return chartNode.drawChart(config.chart)
        .then(() => {
            // Fetch a PNG buffer
            return chartNode.getImageBuffer('image/png');
        })
        .then(buffer => {
            // And when the buffer is ready, return it as a base64 string
            callback(buffer.toString('base64'), null);
        });
}
