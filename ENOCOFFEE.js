var serialPort = require("serialport"); //npm install serialport
var sf = require("sf"); //npm install sf
var irc = require("irc");

// Configs & Globals

var arduinoSerialPath = null;
var serial = null;

var sensorValueBuffer = [800,800,800,800,800];
var sensorValueAvg = 0;

var coffeeLimits = [[25, "no coffee", 0], [100, "half a packet", 250], [200, "one packet", 500], [800, "more than five packets", 2500]];

var ircChannel = "#coffeetest";
var ircServer = "irc.cc.tut.fi";
var botNick = "CoffeeBot";
var ircConfiguration = {
    userName: 'coffeebot',
    realName: 'Your friendly coffee servant',
    port: 6667,
    debug: true,
    showErrors: false,
    autoRejoin: true,
    autoConnect: true,
    channels: [ircChannel],
    secure: true,
    selfSigned: true,
    certExpired: true,
    floodProtection: true,
    floodProtectionDelay: 1000,
    sasl: false,
    stripColors: false,
    channelPrefixes: "&#",
    messageSplit: 512
};

var eventArray = [{id:"500warn", type:"below", limit:200, active:true, timelimit:10*60, timeoutId:null, 
                     action:function(){ircmsg("ELOWCOFFEE: <500 g remaining!");deactivateEvent("500warn");}},
                  {id:"250warn", type:"below", limit:100, active:true, timelimit:10*60, timeoutId:null, 
                     action:function(){ircmsg("EVERYLOWCOFFEE: <250 g remaining!");deactivateEvent("250warn");}
                  {id:"activatewarns", type:"over", limit:220, active:true, timelimit:5*60, timeoutId:null, 
                     action:function(){activateEvent("500warn");activateEvent("250warn");ircmsg("Coffee++ -- coffee now at " + getCoffeeEstimateStr() + " <3")}
                  }];


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
      if (coffeeLimits[i] > sensorValueAvg) {
         return coffeeLimits[i-1][1];
      }
   }
   return coffeeLimits[coffeeLimits.length-1][1];
}

var bot = null;

// Arduino stuff

var pre = "Sensor:",
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
         console.log("Could not find arduino serial path.");
      }
   });
}

function initializeSerial() {
   if (!arduinoSerialPath) {
      console.log("No arduino serial path set, aborting serial initialization.");
      return;
   }

   serial = new serialPort.SerialPort(arduinoSerialPath, {baudrate : 9200});

   serial.on("data", handleSerialData);

   serial.on("error", handleSerialErr);
}

function handleSerialErr(msg) {
   console.log("Serial port error: " + msg);
}

function handleSerialData(chunk) {
   buffer += chunk;
   if (buffer.indexOf(pre) !== -1 && buffer.indexOf(post) !== -1) {
      var parseSnippet = buffer.substring(preIndex+lenPre,postIndex);
      var parseResult = parseInt(parseSnippet);

      sensorValueBuffer.push(parseResult);
      sensorValueBuffer.shift();

      var sum = 0;

      for(var i=0; i < sensorValueBuffer.length; i++;) {
         sum += sensorValueBuffer[i];
      }

      sensorValueAvg = sum / sensorValueBuffer.length;

   }
   buffer = "";

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
            e.timeoutId = setTimeout(e.action, timelimit*1000);
         } else if (e.timeoutId !== null && e.limit < sensorValueAvg) {
            clearTimeout(e.timeoutId);
            e.timeoutId === null;
         }
      } else if (e.type === "over") {
         if (e.timeoutId === null && e.limit < sensorValueAvg) {
            //Set timer
            e.timeoutId = setTimeout(e.action, timelimit*1000);
         } else if (e.timeoutId !== null && e.limit > sensorValueAvg) {
            //Remove timer
            clearTimeout(e.timeoutId);
            e.timeoutId === null;
         }
      } 
   }
}

// IRC stuff

function initializeIRC() {
   bot = new irc.Client(ircServer, botNick, ircConfiguration);
   bot.addListener("message", onIrcMessage);
   client.addListener('error', function(message) {
    console.log('IRC error: ', message);
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
