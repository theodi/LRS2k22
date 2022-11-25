//Loads the config fomr config.env to process.env (turn off prior to deployment)
require("dotenv").config({ path: "./config.env" });
// index.js

/*  EXPRESS */

const express = require('express');
const cors = require("cors");
const http = require('http');
const https = require('https');
const fs = require('fs');
const dbo = require("./db/conn");
const session = require('express-session');
var api = require('./api');
var adaptapi = require('./adaptHandler');
var userHandler = require('./userHandler');
const adaptdb = require("./db/adapt-aat");

if (process.env.SSLKEY) {
  var privateKey  = fs.readFileSync(process.env.SSLKEY, 'utf8');
  var certificate = fs.readFileSync(process.env.SSLCERT, 'utf8');
  var credentials = {key: privateKey, cert: certificate};
}

const app = express();

module.exports = app;

app.set('view engine', 'ejs');

app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: 'SECRET' 
}));

//Put the user object in a global veriable so it can be accessed from templates
app.use(function(req, res, next) {
  try {
    res.locals.user = req.session.passport.user;
    next();
  } catch (error) {
    res.locals.user = req.session.user;
    next();
  }
});

app.use(express.static(__dirname + '/public'));

app.use(cors());

app.use(express.json());

app.get('/', function(req, res) {
  if (req.session.passport) {
    res.redirect("/profile");
  } else { 
    res.locals.pageTitle ="ODI Template (NodeJS + Express + OAuth)";
    res.render('pages/auth');
  }
});

/*  PASSPORT SETUP  */

const passport = require('passport');

app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');

app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

app.get('/error', (req, res) => res.send("error logging in"));

passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

/*  Google AUTH  */
 
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const CALLBACK_URL = "//"+process.env.HOST+"/auth/google/callback"

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL
  },
  function(accessToken, refreshToken, profile, done, req, res) {
    /* No idea what I'm doing here */
      email = profile.emails[0].value;
      var dbConnect = dbo.getDb();
      dbConnect
        .collection("Users")
        .find({'emails.0.value': email})
        .toArray(function(err,items) {
          if (items.length < 1) {
            userHandler.insertUser(dbo,profile);
            return done(null, profile);
          } else if (items[0].suspended) {
            return done(null, null);
          } else {
            userHandler.updateLastLoginTime(dbo,email);
            return done(null, profile);
          }
        });
  }
));
 
app.get('/auth/google', 
  passport.authenticate('google', { scope : ['profile', 'email'] }));
 
app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/error' }),
  function(req, res) {
    // Successful authentication, redirect success.
    res.redirect('/profile');
  });

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    unauthorised(res);
}

app.use('/private', ensureAuthenticated);
app.use('/private', express.static(__dirname + '/private'));


/* Define all the pages */

/* Do not require login */

app.get('/page1', function(req, res) {
  res.locals.pageTitle = "Page 1";
  res.render('pages/page1');
});

/*
 * e.g. /questionSummary?activity=https://learning.theodi.org/xapi/activities/mit-moral-machine-test#/id/630f81656b4097008b2afd6f_branching_0
 * e.g. https://theodi.stream.org/xapi/activities/learning-lockker-stand-alone-xapi-test-dt%23/id/5fd8d72191349e0067628eb3
 */
app.get('/questionSummary', function(req, res) {
  res.locals.pageTitle = "Question insights";
  res.locals.activity = encodeURIComponent(req.query.activity);
  res.render('pages/questionSummary');
});

/* Require user to be logged in */

function unauthorised(res) {
  res.locals.pageTitle = "401 Unauthorised";
  return res.status(401).render("errors/401");
}

app.get('/profile', function(req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  res.locals.pageTitle = "Profile page";
  res.render('pages/profile');
});

app.get('/courses', function(req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  res.locals.pageTitle = "Courses";
  res.render('pages/courses');

});

app.get('/course/:id', function(req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  res.locals.pageTitle = "Course" + req.params.id;
  res.locals.id = req.params.id;
  res.render('pages/contentObject');
});

app.get('/course/:id/dashboard', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  res.locals.pageTitle = "Course " + req.params.id;
  res.locals.id = req.params.id;
  res.render('pages/contentObjectDashboard');
});

app.get('/course/:id/transcript', function(req,res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  res.locals.pageTitle = "Course " + req.params.id;
  res.locals.id = req.params.id;
  res.render('pages/contentObjectTranscript');
});

/* API requests private methods */ 

app.get('/api/activityData', function (req, res) {
  if (!req.isAuthenticated()) { unauthorised(res); return; }
  api.getActivityData(req, res); 
});

/* The complete adapt API */

/**
 * api/courses
 * List all courses
 */ 
app.get('/api/courses', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getObjectsFromCollection(req, res, adaptdb, "courses");
});

app.get('/api/courseDetail', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getCourses(req, res, dbo);
});

app.get('/api/contentObject/:id', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getContentObject(req, res, dbo, req.params.id);
});
app.get('/api/contentObject/:id/config', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getContentObjectConfig(req, res, dbo, req.params.id);
});

/*
 * API requests, public methods 
 */
app.get('/api/questionSummary', function (req, res) {
  api.getQuestionSummaryData(req, res); 
});

/**
 * api/collection
 * Get all items in a collection for a specific parentId
 * e.g. api/contentobjects/?parentId=xxxxxx
 * e.g. api/blocks/?parentId=xxxxxx
 */
app.get('/api/:collection/', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  if (req.query.parentId) {
    adaptapi.findObjectsWithParentId(req, res, adaptdb, req.params.collection, req.query.parentId);
  } else {
    return res.status(400).render("errors/400");
  }
});

/**
 * api/collection/:id
 * Get data for a single item e.g. article, course, block, component
 * e.g. api/contentobject/xxxxxx
 * e.g. api/block/xxxxxx
 */
app.get('/api/:collection/:id', function(req,res) {
  if (!req.isAuthenticated() && req.headers.host.split(":")[0] != "localhost") { unauthorised(res); return; }
  adaptapi.getObjectById(req, res, adaptdb, req.params.collection, req.params.id);
});

//Keep this at the END!

app.get('*', function(req, res){
  res.locals.pageTitle = "404 Not Found";
  return res.status(404).render("errors/404");
});

adaptdb.connectToServer(function (err) {
  if(err) {
    console.log(err);
  }
});

/*
setTimeout(() => {
  adaptapi.updateCourseCache(adaptdb,dbo);
},2000);

setInterval(() => {
  adaptapi.updateCourseCache(adaptdb,dbo);
},1800000);
*/

/* Run server */

// perform a database connection when the server starts
dbo.connectToServer(function (err) {
  if (err) {
    console.error(err);
    process.exit();
  }

  const port = process.env.PORT || 80;
  // start the Express server
  var httpServer = http.createServer(app);
  httpServer.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
  });
  if (process.env.SSLKEY) {
    const securePort = process.env.SECUREPORT || 443;
    var httpsServer = https.createServer(credentials,app);
    httpsServer.listen(securePort, () => {
      console.log(`Server is running on port: 443`);
    });
  }

});
