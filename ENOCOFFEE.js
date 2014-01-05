var serialPort = require("serialport"); //npm install serialport
var sf = require("sf"); //npm install sf
var irc = require("irc");

// Configs & Globals

var arduinoSerialPath = null;
var serial = null;

var sensorValueBuffer = [800,800,800,800,800];
var sensorValueAvg = 0;

var coffeeLimits = [[25, "no coffee", 0], [100, "half a packet", 250], [200, "one packet", 500], [800, "more than five packets", 2500]];

var ircChannel = "#coffeetest2";
var ircServer = "irc.cc.tut.fi";
var botNick = "CoffeeBotJr";
var ircConfiguration = {
    userName: 'coffeebot',
    realName: 'Your friendly coffee servant',
    port: 6667,
    debug: true,
    showErrors: false,
    autoRejoin: true,
    autoConnect: true,
    channels: [ircChannel],
    secure: false,
    selfSigned: false,
    certExpired: false,
    floodProtection: true,
    floodProtectionDelay: 1000,
    messageSplit: 512
};

var eventArray = [{id:"500warn", type:"below", limit:200, active:true, timelimit:10*60, timeoutId:null, 
                     action:function(){ircmsg("ELOWCOFFEE: <500 g remaining!");deactivateEvent("500warn");activateEvent("activatewarns")}},
                  {id:"250warn", type:"below", limit:100, active:true, timelimit:10*60, timeoutId:null, 
                     action:function(){ircmsg("EVERYLOWCOFFEE: <250 g remaining!");deactivateEvent("250warn");activateEvent("activatewarns")}},
                  {id:"activatewarns", type:"over", limit:220, active:false, timelimit:5*60, timeoutId:null, 
                     action:function(){activateEvent("500warn");activateEvent("250warn");ircmsg("Coffee++ -- coffee now at " + getCoffeeEstimateStr() + " <3")}}
                  ];

var bot = null;

// Startup

determineArduinoSerialPath();
initializeIRC();
initializeSerial();

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

   serial.on("data", handleSerialData);

   serial.on("error", handleSerialErr);
}

function handleSerialErr(msg) {
   console.log("Serial port error: " + msg);
   setTimeout(deterineArduinoSerialPath, 2000);
   setTimeout(initializeSerial, 4000);
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
  //if(sensorValueAvg % 10 === 0) {
  //  console.log("Sensor value avg: " + sensorValueAvg);
  //}
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
  bot = new irc.Client(ircServer, botNick, ircConfiguration);
  bot.addListener("message", onIrcMessage);
  bot.addListener('error', function(message) {
    console.log('IRC error: ', message);
  });
  bot.addListener('quit', function(message) {
    console.log('IRC quit: ', message);
  });
}

function ircmsg(msg) {
   bot.say(ircChannel, msg);
}

function onIrcMessage(from, to, message) {
   if (message.substring(0,7) === "!coffee") {
      ircmsg("Coffee currently at " + getCoffeeEstimateStr() + ".");
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
         return returnVal + " (" + sensorValueAvg.toString() + ")";
      }
   }
   return coffeeLimits[coffeeLimits.length-1][1];
}