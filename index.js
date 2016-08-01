'use strict';

const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const request = require('request');


//Stroll API address
const fakie_images = 'http://fakie.westus.cloudapp.azure.com:9090/sh/images/';
const fakie_url = 'http://40.112.187.184:9090/sh/';

let Wit = null;
let log = null;
try {
  Wit = require('../').Wit;
  log = require('../').log;
} catch (e) {
  Wit = require('node-wit').Wit;
  log = require('node-wit').log;
}

const PORT = process.env.PORT || 8445;


const WIT_TOKEN = "2CLXA6ZEFYK66WYOV3XZUQZHNDJJLKGQ";


const FB_PAGE_ID = "YOUR_ID";
const FB_PAGE_TOKEN = "YOUR_TOKEN";
const FB_APP_SECRET = "YOUR_SECRET";

let FB_VERIFY_TOKEN = "my_voice_is_my_password_verify_me";
crypto.randomBytes(8, (err, buff) => {
  if (err) throw err;
  FB_VERIFY_TOKEN = buff.toString('hex');
  console.log(`/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"`);
});

const fbMessage = (id, messageData) => {
  const body = JSON.stringify({
    recipient: { id },
    message: messageData,
  });
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      if (json.error.code != 100)
        throw new Error(json.error.message);
    }
    return json;
  });
};

const fbTyping = (id, typing) => {
  var action = typing ? "typing_on" : "typing_off";
  const body = JSON.stringify({
    recipient: { id },
    sender_action: action
  });
  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      if (json.error.code != 100)
        throw new Error(json.error.message);
    }
    return json;
  });
};



// ----------------------------------------------------------------------------
// Wit.ai bot specific code

// This will contain all user sessions.
// Each session has an entry:
// sessionId -> {fbid: facebookUserId, context: sessionState}
const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Our bot actions
const actions = {
  send({sessionId}, {text}) {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = sessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      // We return a promise to let our bot know when we're done sending
      return fbMessage(recipientId, {text})
      .then(() => null)
      .catch((err) => {
        console.error(
          'Oops! An error occurred while forwarding the response to',
          recipientId,
          ':',
          err.stack || err
        );
      });
    } else {
      console.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
    }
  },
  getCPT({context, entities}) {
    return new Promise(function(resolve, reject) {
      console.log(entities);
      //hackathon temp fix
      if (entities["cpt_code"] != null)
        var cpt_code = firstEntityValue(entities, "cpt_code");
      else{
        var cpt_code = firstEntityValue(entities, "location");
      }
      if (cpt_code){
        fetch(fakie_url + 'cpt/codes/' + cpt_code, {
          method: 'GET',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/vnd.sh-v1.0+json'},
        })
        .catch((err) => {
          context.cpt_fail = true;
          console.error(
            'FETCH ERROR: ',
            err.stack || err
          );
          return resolve(context);
        })
        .then(rsp => rsp.json())
        .then(json => {
           console.log("desc " + json.description);
           context.cpt_code = cpt_code;
           context.cpt_desc = json.description;
           return resolve(context);
        });

      }
      else{
        context.cpt_fail = true;
        console.log("cpt failed");
        return resolve(context);
      }

    });

  },
  getAddress({context, entities}) {
    return new Promise(function(resolve, reject) {
      context.user_address = firstEntityValue(entities, "location");
      return resolve(context);
    });
  },
  getFacilities({context}){
    return new Promise(function(resolve, reject) {
      // Here should go the api call, e.g.:
      // context.forecast = apiCall(context.loc)
      if (context.cpt_code && context.user_address){
        fbTyping("1162690793752002", true);
        fetch(fakie_url + 'prices?patientId=1208&userId=2&cptCodeIds=' + context.cpt_code, {
          method: 'GET',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/vnd.sh-v1.0+json'},
        })
        .catch((err) => {
          console.error(
            'FETCH ERROR: ',
            err.stack || err
          );
          return;
        })
        .then(rsp => rsp.json())
        .then(json => {
           let costDTOs = json["costDTOs"];
           costDTOs.sort(compareCosts);
           let bestValueOptions = [];
           let count = costDTOs.length > 3 ? 3 : costDTOs.length;
           for (let i = 0; i < count; i ++){
             let dto = costDTOs[i];
             let elem = {
               "title": dto.facility,
               "subtitle": "$" + dto.cost + "\t\t" + dto.address,
               "image_url": fakie_images + encodeURIComponent(dto.image),
               "buttons": [{
                 "type": "web_url",
                 "url": "http://maps.google.com/?q=" + encodeURIComponent(dto.facility),
                 "title": "Open in Google Maps",
               }, {
                 "type": "postback",
                 "title": "Order Via Stroll",
                 "payload": "Payload for order button element",
               }],
             };
             bestValueOptions.push(elem);
           }
           let messageData = {
             "attachment": {
               "type": "template",
               "payload": {
                 "template_type": "generic",
                 "elements": bestValueOptions
               }
             },
           }
           //TODO: Harcoded user id
           fbMessage("1162690793752002", messageData);
           return;
        });

      }

    });
  },
  // You should implement your custom actions here
  // See https://wit.ai/docs/quickstart
};

function compareCosts(a, b){
  if (parseFloat(a["cost"]) > parseFloat(b["cost"])){
    return 1;
  }
  if (parseFloat(a["cost"]) < parseFloat(b["cost"])){
    return -1;
  }
  return 0;
}



function firstEntityValue(entities, keyword){
  var arr = entities[keyword];
  return arr[0].value;
}

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  actions,
  logger: new log.Logger(log.INFO)
});

// Starting our webserver and putting it all together
const app = express();
app.use(({method, url}, rsp, next) => {
  rsp.on('finish', () => {
    console.log(`${rsp.statusCode} ${method} ${url}`);
  });
  next();
});
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// Webhook setup
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Message handler
app.post('/webhook', (req, res) => {
  // Parse the Messenger payload
  // See the Webhook reference
  // https://developers.facebook.com/docs/messenger-platform/webhook-reference
  const data = req.body;

  if (data.object === 'page') {
    data.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message) {
          // Yay! We got a new message!
          // We retrieve the Facebook user ID of the sender
          const sender = event.sender.id;
          // We retrieve the user's current session, or create one if it doesn't exist
          // This is needed for our bot to figure out the conversation history
          const sessionId = findOrCreateSession(sender);

          // We retrieve the message content
          const {text, attachments} = event.message;

          if (attachments) {
            // We received an attachment
            // Let's reply with an automatic message
            fbMessage(sender, 'Sorry I can only process text messages for now.')
            .catch(console.error);
          } else if (text) {
            // We received a text message

            // Let's forward the message to the Wit.ai Bot Engine
            // This will run all actions until our bot has nothing left to do
            wit.runActions(
              sessionId, // the user's current session
              text, // the user's message
              sessions[sessionId].context // the user's current session state
            ).then((context) => {
              // Our bot did everything it has to do.
              // Now it's waiting for further messages to proceed.
              console.log('Waiting for next user messages');

              // Based on the session state, you might want to reset the session.
              // This depends heavily on the business logic of your bot.
              // Example:
              // if (context['done']) {
              //   delete sessions[sessionId];
              // }

              // Updating the user's current session state
              sessions[sessionId].context = context;
            })
            .catch((err) => {
              console.error('Oops! Got an error from Wit: ', err.stack || err);
            })
          }
        } else {
          console.log('received event', JSON.stringify(event));
        }
      });
    });
  }
  res.sendStatus(200);
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');
    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

app.listen(PORT);
console.log('Listening on :' + PORT + '...');
