var serialPort = require("serialport"); //npm install serialport
var sf = require("sf"); //npm install sf
var irc = require("irc"); //npm install node-irc

// Configs & Globals

var arduinoSerialPath = null;
var serial = null;

var sensorValueBuffer = [800,800,800,800,800];
var sensorValueAvg = 0;

var latestUpdate = null;

var coffeeAmountSamples = [800, 800, 800, 800, 800]; // to observe when the coffee is added.

var coffeeLimits = [[35, "no coffee", 0],
                     [36, "practically no coffee", 5], 
                     [60, "less than a quarter of a packet", 90],
                     [80, "quarter of a packet", 125], 
                     [130, "half a packet", 250], 
                     [190, "one packet", 500], 
                     [280, "one and half packets", 750], 
                     [360, "two packets", 1000],
                     [460, "two and half packets", 1250],
                     [540, "three packets", 1500],
                     [640, "three and half packets", 1750],
                     [720, "four packets", 2000],
                     [810, "four and half packets", 2250],
                     [800, "five packets or more \\:D/", 2500]];

var ircChannel = "#coffeetest2";
var ircServer = "irc.cc.tut.fi";
var botNick = "CoffeeBot";
var ircConfiguration = {
    userName: 'coffeebot',
    realName: 'Your friendly coffee servant',
    port: 6667,
    debug: false,
    showErrors: false,
    autoRejoin: true,
    autoConnect: true,
    channels: [ircChannel],
    secure: false,
    selfSigned: true,
    certExpired: true,
    floodProtection: true,
    floodProtectionDelay: 1000,
    messageSplit: 512
};

var eventArray = [{id:"500warn", type:"below", limit:190, active:true, timelimit:10*60, timeoutId:null, 
                     action:function()
                        {
                           ircnotice("ELOWCOFFEE: ~500 g remaining!");
                           deactivateEvent("500warn");
                           activateEvent("activatewarns");
                        }},
                  {id:"250warn", type:"below", limit:120, active:true, timelimit:10*60, timeoutId:null, 
                     action:function()
                        {
                           ircnotice("EVERYLOWCOFFEE: ~250 g remaining!");
                           deactivateEvent("250warn");
                           activateEvent("activatewarns");
                        }},
                  {id:"100warn", type:"below", limit:60, active:true, timelimit:10*60, timeoutId:null, 
                     action:function()
                        {
                           ircnotice("ECOFFEECRITICAL: We're running on fumes!");
                           deactivateEvent("250warn");
                           activateEvent("activatewarns");
                        }},
                  {id:"activatewarns", type:"over", limit:191, active:false, timelimit:5*60, timeoutId:null, 
                     action:function()
                        {
                           activateEvent("500warn");
                           activateEvent("250warn");
                           activateEvent("100warn");
                           //ircnotice("Coffee++ -- coffee now at " + getCoffeeEstimateStr() + ".");
                        }}
                  ];

function determineIfCoffeeAdded() {
   if ((coffeeAmountSamples[0]+coffeeAmountSamples[1]+coffeeAmountSamples[2]+coffeeAmountSamples[3]+coffeeAmountSamples[4])/5+40 < sensorValueAvg) {
      setTimeout(function() {ircnotice("Coffee++ -- coffee now at " + getCoffeeEstimateStr() + ".");}, 5000); // wait a bit to let the average settle.
      coffeeAmountSamples[0] = sensorValueAvg;
      coffeeAmountSamples[1] = sensorValueAvg;
      coffeeAmountSamples[2] = sensorValueAvg;
      coffeeAmountSamples[3] = sensorValueAvg;
      coffeeAmountSamples[4] = sensorValueAvg;
   }
   coffeeAmountSamples.push(sensorValueAvg);
   coffeeAmountSamples.shift();
}

var bot = null;

// Startup

determineArduinoSerialPath();
initializeIRC();
initializeSerial();
setInterval(function() {bot.say(botNick, "a");}, 5*60*1000); //Say something so self every once in a while to trigger the autoconnect 
                                                          //if we have dropped from the net. (It's a hack.)
setInterval(determineIfCoffeeAdded, 2*60*1000);

// Arduino stuff

var pre = "sensor:",
    post = "-units"; // Arduino should put out something like "Sensor:150-units\r\n"

var serialBuffer = "";

function determineArduinoSerialPath() {
   // Finds arduino serial port and appends it to "arduinoserial" global variable. Only works properly if there is only 
   // one existing tty where manufacturer string contains "Arduino".
   serialPort.list(function (err, results) {
      if (err) {
         throw err;
      }
      var found = false;
      for (var i = 0; i < results.length; i++) {
         if (results[i]["manufacturer"].indexOf("Arduino") !== -1) {
            found = true;
            arduinoSerialPath = results[i]["comName"];
            console.log("Arduino serial found: " + arduinoSerialPath);
         } else if (result[i]["pnpId"].indexOf("Arduino") !== -1) {
            found = true;
            arduinoSerialPath = results[i]["comName"];
            console.log("Arduino serial found: " + arduinoSerialPath);
         }
      }
      if (!found) {
         console.log("Could not find arduino serial path. Trying again in one second...");
         setTimeout(determineArduinoSerialPath, 1000);
      }
   });
}

function initializeSerial() {
   if (!arduinoSerialPath) {
      console.log("No arduino serial path set, aborting serial initialization. Trying again in one second...");
            setTimeout(initializeSerial, 1000);
      return;
   }

   serial = new serialPort.SerialPort(arduinoSerialPath, {baudrate : 9200});

   console.log("Arduino serial opened: " + arduinoSerialPath);

   serial.on("data", handleSerialData);

   serial.on("error", handleSerialErr);
}

function handleSerialErr(msg) {
   console.log("Serial port error: " + msg);
   setTimeout(determineArduinoSerialPath, 2000);
   setTimeout(initializeSerial, 10000);
}

function handleSerialData(chunk) {
   serialBuffer += chunk;
   serialBuffer = serialBuffer.replace(/ /g,'').replace(/(\r\n|\n|\r)/gm,""); //remove whitespaces etc.
   //console.log(serialBuffer);
   if (serialBuffer.indexOf(pre) !== -1 && serialBuffer.indexOf(post) !== -1) {
      var parseSnippet = serialBuffer.substring(serialBuffer.indexOf(pre)+pre.length,serialBuffer.indexOf(post));
      var parseResult = parseInt(parseSnippet);

      sensorValueBuffer.push(parseResult);
      sensorValueBuffer.shift();

      latestUpdate = new Date();

      //console.log(parseResult);

      var sum = 0;

      for(var i=0; i < sensorValueBuffer.length; i++) {
         sum += sensorValueBuffer[i];
      }

      sensorValueAvg = sum / sensorValueBuffer.length;

   }
   serialBuffer = "";

   handleEvents();
}

//{id:"500warn", type:"below", limit:200, active:true, timelimit:10*60, timeoutId:null, 
//                     action:function(){ircmsg("ELOWCOFFEE: <500 g remaining!");deactivateEvent("500warn");}}

function handleEvents() {

  for(var i=0;i<eventArray.length;i++) {
      var e = eventArray[i];

      if (!e.active) {
         continue;
      }

      if (e.type === "below") {
         
         if (e.timeoutId === null && e.limit > sensorValueAvg) {
            //Set timer
            e.timeoutId = setTimeout(e.action, e.timelimit*1000);
         } else if (e.timeoutId !== null && e.limit < sensorValueAvg) {
            clearTimeout(e.timeoutId);
            e.timeoutId = null;
         }
      } else if (e.type === "over") {
         if (e.timeoutId === null && e.limit < sensorValueAvg) {
            //Set timer
            e.timeoutId = setTimeout(e.action, e.timelimit*1000);
         } else if (e.timeoutId !== null && e.limit > sensorValueAvg) {
            //Remove timer
            clearTimeout(e.timeoutId);
            e.timeoutId = null;
         }
      } 
   }
}

// IRC stuff

function initializeIRC() {
   console.log("Initializing IRC connection...");
   bot = new irc.Client(ircServer, botNick, ircConfiguration);
   bot.addListener("message", onIrcMessage);
   bot.addListener('error', function(message) {
      console.log('IRC error: ', message);
   });
   bot.addListener('names', function(chan, nicks) {
      console.log("Connected to channel " + ircChannel);
   });
}

function ircmsg(msg) {
   bot.say(ircChannel, msg);
}

function ircnotice(msg) {
   bot.say(ircChannel, msg);
}

function onIrcMessage(from, to, message) {
   if (message.substring(0,7) === "!coffee") {
      var msg = "Coffee currently at " + getCoffeeEstimateStr() + ". (Latest update " + ((new Date() - latestUpdate) / 1000).toString() + " seconds ago)";
      if (to === botNick) {
         bot.say(from, msg);
      } else {
         ircmsg(msg);
      }
   }
}

// Helper functions

function deactivateEvent(id) {
   for(var i=0;i<eventArray.length;i++) {
      if (eventArray[i].id == id) {
         eventArray[i].active = false;
      }
   }
}

function activateEvent(id) {
   for(var i=0;i<eventArray.length;i++) {
      if (eventArray[i].id == id) {
         eventArray[i].active = true;
      }
   }
}

function getCoffeeEstimateStr() {
   for(var i=1;i<coffeeLimits.length;i++) {
      if (coffeeLimits[i][0] > sensorValueAvg) {
         var returnVal = coffeeLimits[i-1][1];
         //console.log(returnVal);
         return returnVal;
      }
   }
   return coffeeLimits[coffeeLimits.length-1][1];
}